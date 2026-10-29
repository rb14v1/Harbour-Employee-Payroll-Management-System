import { Router } from 'express';
import { z } from 'zod';
import { authenticate, orgId, requirePermission } from '../../middleware/auth.js';
import { asyncHandler, objectId, validate } from '../../middleware/common.js';
import { conflict, notFound } from '../../shared/errors.js';
import { audit } from '../audit/audit.service.js';
import { Employee } from '../employees/employee.model.js';
import { Organization } from '../organizations/organization.model.js';
import { Department, Designation } from './department.model.js';

export const departmentsRouter = Router();
export const designationsRouter = Router();
export const organizationRouter = Router();
for (const r of [departmentsRouter, designationsRouter, organizationRouter]) r.use(authenticate);

const deptBody = z.object({ name: z.string().min(1).max(100), code: z.string().min(1).max(20), headEmployeeId: objectId.nullable().optional() });

departmentsRouter.get('/', asyncHandler(async (req, res) => {
  const rows = await Department.find({ organizationId: orgId(req) }).sort({ name: 1 }).lean();
  res.json({ data: rows });
}));

departmentsRouter.post('/', requirePermission('department:manage'), validate({ body: deptBody }), asyncHandler(async (req, res) => {
  const b = req.body as z.infer<typeof deptBody>;
  const doc = await Department.create({ ...b, headEmployeeId: b.headEmployeeId ?? undefined, organizationId: orgId(req) });
  await audit(req, { action: 'department.create', entityType: 'Department', entityId: doc.id, summary: b });
  res.status(201).json({ data: doc });
}));

departmentsRouter.patch(
  '/:id',
  requirePermission('department:manage'),
  validate({ params: z.object({ id: objectId }), body: deptBody.partial().extend({ isActive: z.boolean().optional() }) }),
  asyncHandler(async (req, res) => {
    const doc = await Department.findOne({ _id: req.params.id, organizationId: orgId(req) });
    if (!doc) throw notFound('Department not found');
    const b = req.body as Record<string, unknown>;
    if (b.isActive === false && (await Employee.exists({ organizationId: orgId(req), departmentId: doc._id, status: { $ne: 'inactive' } }))) {
      throw conflict('Department still has active employees');
    }
    Object.assign(doc, b);
    await doc.save();
    await audit(req, { action: 'department.update', entityType: 'Department', entityId: doc.id, summary: b });
    res.json({ data: doc });
  }),
);

const desBody = z.object({ title: z.string().min(1).max(100), level: z.number().int().min(0).max(50).optional() });

designationsRouter.get('/', asyncHandler(async (req, res) => {
  res.json({ data: await Designation.find({ organizationId: orgId(req) }).sort({ level: 1, title: 1 }).lean() });
}));

designationsRouter.post('/', requirePermission('department:manage'), validate({ body: desBody }), asyncHandler(async (req, res) => {
  const doc = await Designation.create({ ...(req.body as object), organizationId: orgId(req) });
  await audit(req, { action: 'designation.create', entityType: 'Designation', entityId: doc.id, summary: req.body });
  res.status(201).json({ data: doc });
}));

const orgPatch = z.object({
  name: z.string().min(1).max(200).optional(),
  logoText: z.string().max(100).optional(),
  currency: z.string().length(3).optional(),
  timezone: z.string().max(60).optional(),
  financialYearStartMonth: z.number().int().min(1).max(12).optional(),
  locations: z.array(z.object({ name: z.string().min(1).max(100), state: z.string().min(1).max(50) })).max(200).optional(),
  settings: z
    .object({
      segregationOfDuties: z.boolean().optional(),
      standardMonthDays: z.number().int().min(28).max(31).optional(),
      prorationBasis: z.enum(['calendar_days', 'fixed_days']).optional(),
    })
    .optional(),
});

organizationRouter.get('/', asyncHandler(async (req, res) => {
  const org = await Organization.findById(orgId(req)).lean();
  if (!org) throw notFound();
  res.json({ data: org });
}));

organizationRouter.patch('/', requirePermission('org:manage'), validate({ body: orgPatch }), asyncHandler(async (req, res) => {
  const org = await Organization.findById(orgId(req));
  if (!org) throw notFound();
  const { settings, ...rest } = req.body as z.infer<typeof orgPatch>;
  Object.assign(org, rest);
  if (settings) for (const [k, v] of Object.entries(settings)) org.set(`settings.${k}`, v);
  await org.save();
  await audit(req, { action: 'organization.update', entityType: 'Organization', entityId: org.id, summary: req.body });
  res.json({ data: org });
}));
