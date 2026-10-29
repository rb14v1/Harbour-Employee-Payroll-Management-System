import { Router } from 'express';
import { z } from 'zod';
import { authenticate, orgId, requirePermission } from '../../middleware/auth.js';
import { asyncHandler, objectId, validate } from '../../middleware/common.js';
import { badRequest, conflict, notFound, unprocessable } from '../../shared/errors.js';
import { audit } from '../audit/audit.service.js';
import { Employee } from '../employees/employee.model.js';
import { assertEmployeeAccess } from '../employees/scope.js';
import { validateStructure } from '../payroll/engine/engine.js';
import { COMPONENT_TYPES, SalaryRevision, SalaryStructure } from './salary.model.js';

export const salaryRouter = Router();
salaryRouter.use(authenticate);

const component = z.object({
  code: z.string().min(1).max(30).regex(/^[A-Za-z0-9_]+$/, 'Letters, digits and underscore only'),
  name: z.string().min(1).max(100),
  type: z.enum(COMPONENT_TYPES),
  annualAmount: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  prorated: z.boolean().default(true),
  isBasic: z.boolean().default(false),
});

const structureBody = z.object({
  name: z.string().min(1).max(100),
  annualCtc: z.number().int().min(0),
  components: z.array(component).min(1).max(40),
  effectiveFrom: z.coerce.date(),
  effectiveTo: z.coerce.date().nullable().optional(),
});

function assertReconciles(b: { components: { code: string; type: string; annualAmount: number }[]; annualCtc: number }) {
  const codes = b.components.map((c) => c.code.toUpperCase());
  if (new Set(codes).size !== codes.length) throw badRequest('Duplicate component codes');
  const problems = validateStructure(b.components, b.annualCtc);
  if (problems.length) throw unprocessable('Salary structure does not reconcile', problems);
}

salaryRouter.get('/salary-structures', requirePermission('salary:read'), asyncHandler(async (req, res) => {
  res.json({ data: await SalaryStructure.find({ organizationId: orgId(req) }).sort({ name: 1 }).lean() });
}));

salaryRouter.post('/salary-structures', requirePermission('salary:manage'), validate({ body: structureBody }), asyncHandler(async (req, res) => {
  const b = req.body as z.infer<typeof structureBody>;
  assertReconciles(b);
  const doc = await SalaryStructure.create({ ...b, effectiveTo: b.effectiveTo ?? undefined, organizationId: orgId(req) });
  await audit(req, { action: 'salary_structure.create', entityType: 'SalaryStructure', entityId: doc.id, summary: { name: b.name, annualCtc: b.annualCtc } });
  res.status(201).json({ data: doc });
}));

salaryRouter.get('/salary-structures/:id', requirePermission('salary:read'), validate({ params: z.object({ id: objectId }) }), asyncHandler(async (req, res) => {
  const doc = await SalaryStructure.findOne({ _id: req.params.id, organizationId: orgId(req) }).lean();
  if (!doc) throw notFound('Salary structure not found');
  res.json({ data: doc });
}));

// Editing a template never rewrites history: employee revisions hold their own component snapshots.
salaryRouter.patch(
  '/salary-structures/:id',
  requirePermission('salary:manage'),
  validate({ params: z.object({ id: objectId }), body: structureBody.partial().extend({ isActive: z.boolean().optional() }) }),
  asyncHandler(async (req, res) => {
    const doc = await SalaryStructure.findOne({ _id: req.params.id, organizationId: orgId(req) });
    if (!doc) throw notFound('Salary structure not found');
    const b = req.body as Partial<z.infer<typeof structureBody>> & { isActive?: boolean };
    const merged = { components: b.components ?? doc.components.map((c) => c.toObject()), annualCtc: b.annualCtc ?? doc.annualCtc };
    assertReconciles(merged);
    const { effectiveTo, ...rest } = b;
    Object.assign(doc, rest);
    if (effectiveTo !== undefined) doc.effectiveTo = (effectiveTo ?? undefined) as never;
    doc.version += 1;
    await doc.save();
    await audit(req, { action: 'salary_structure.update', entityType: 'SalaryStructure', entityId: doc.id, summary: { fields: Object.keys(b), version: doc.version } });
    res.json({ data: doc });
  }),
);

const revisionBody = z.object({
  structureId: objectId,
  effectiveFrom: z.coerce.date(),
  reason: z.string().min(3).max(500),
  override: z.object({ annualCtc: z.number().int().min(0), components: z.array(component).min(1).max(40) }).optional(),
});

salaryRouter.post(
  '/employees/:id/salary-revisions',
  requirePermission('salary:manage'),
  validate({ params: z.object({ id: objectId }), body: revisionBody }),
  asyncHandler(async (req, res) => {
    const id = req.params.id as string;
    const b = req.body as z.infer<typeof revisionBody>;
    const org = orgId(req);
    const employee = await Employee.findOne({ _id: id, organizationId: org });
    if (!employee) throw notFound('Employee not found');
    const structure = await SalaryStructure.findOne({ _id: b.structureId, organizationId: org, isActive: true });
    if (!structure) throw badRequest('Unknown or inactive salary structure');

    const source = b.override ?? { annualCtc: structure.annualCtc, components: structure.components.map((c) => c.toObject()) };
    assertReconciles(source);

    const latest = await SalaryRevision.findOne({ organizationId: org, employeeId: id }).sort({ effectiveFrom: -1 });
    if (latest && latest.effectiveFrom.getTime() >= b.effectiveFrom.getTime()) {
      throw conflict('Effective date must be later than the current revision; revisions are append-only');
    }
    if (latest && !latest.effectiveTo) {
      latest.effectiveTo = new Date(b.effectiveFrom.getTime() - 86_400_000);
      await latest.save();
    }
    const rev = await SalaryRevision.create({
      organizationId: org,
      employeeId: id,
      structureId: structure._id,
      components: source.components,
      annualCtc: source.annualCtc,
      isOverride: Boolean(b.override),
      effectiveFrom: b.effectiveFrom,
      reason: b.reason,
      createdBy: req.auth!.userId,
    });
    await audit(req, { action: 'salary_revision.create', entityType: 'Employee', entityId: id, summary: { revisionId: rev.id, structureId: b.structureId, annualCtc: source.annualCtc, override: Boolean(b.override), effectiveFrom: b.effectiveFrom } });
    res.status(201).json({ data: rev });
  }),
);

salaryRouter.get('/employees/:id/salary-revisions', requirePermission('salary:read'), validate({ params: z.object({ id: objectId }) }), asyncHandler(async (req, res) => {
  await assertEmployeeAccess(req, req.params.id as string);
  res.json({ data: await SalaryRevision.find({ organizationId: orgId(req), employeeId: req.params.id }).sort({ effectiveFrom: -1 }).lean() });
}));
