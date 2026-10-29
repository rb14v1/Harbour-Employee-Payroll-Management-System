import { Router, type Request } from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { z } from 'zod';
import { authenticate, orgId, requirePermission } from '../../middleware/auth.js';
import { asyncHandler, objectId, validate } from '../../middleware/common.js';
import { badRequest, conflict, notFound } from '../../shared/errors.js';
import { escapeRegex, pageMeta, paginationSchema } from '../../shared/pagination.js';
import { hasPermission } from '../../shared/permissions.js';
import { audit } from '../audit/audit.service.js';
import { Department, Designation } from '../departments/department.model.js';
import { PayrollEntry } from '../payroll/payroll.model.js';
import { Types } from 'mongoose';
import { FINALIZED, type PayrollStatus } from '../payroll/state-machine.js';
import { Employee, EMPLOYMENT_STATUS, EMPLOYMENT_TYPE, nextEmployeeCode } from './employee.model.js';
import { assertEmployeeAccess, scopeFilter } from './scope.js';

export const employeesRouter = Router();
employeesRouter.use(authenticate);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ok = /\.csv$/i.test(file.originalname) && ['text/csv', 'application/vnd.ms-excel', 'text/plain'].includes(file.mimetype);
    if (ok) cb(null, true);
    else cb(badRequest('Only .csv files are accepted'));
  },
});

const statutory = z.object({
  taxRegime: z.enum(['old', 'new']).default('new'),
  pfApplicable: z.boolean().default(false),
  esiApplicable: z.boolean().default(false),
  ptApplicable: z.boolean().default(false),
  ptState: z.string().max(50).optional(),
});
const bank = z.object({
  accountHolder: z.string().max(100),
  accountNumber: z.string().regex(/^\d{6,20}$/, 'Account number must be 6-20 digits'),
  ifsc: z.string().regex(/^[A-Za-z]{4}0[A-Za-z0-9]{6}$/, 'Invalid IFSC'),
});

const employeeBody = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  workEmail: z.string().email().max(254),
  departmentId: objectId,
  designationId: objectId,
  managerId: objectId.nullable().optional(),
  joiningDate: z.coerce.date(),
  exitDate: z.coerce.date().nullable().optional(),
  status: z.enum(EMPLOYMENT_STATUS).default('active'),
  employmentType: z.enum(EMPLOYMENT_TYPE).default('full_time'),
  workLocation: z.string().min(1).max(100),
  statutory: statutory.default({ taxRegime: 'new', pfApplicable: false, esiApplicable: false, ptApplicable: false }),
  bank: bank.optional(),
  panNumber: z.string().regex(/^[A-Za-z]{5}\d{4}[A-Za-z]$/, 'Invalid PAN format').optional(),
});
const employeePatch = employeeBody.partial();

const canSeeSensitive = (req: Request, employeeId: string) =>
  hasPermission(req.auth!.role, 'employee:sensitive') || req.auth!.employeeId === employeeId;

const mask = (v?: string | null) => (v ? `${'*'.repeat(Math.max(0, v.length - 4))}${v.slice(-4)}` : undefined);

async function present(req: Request, id: string) {
  const e = await Employee.findOne({ _id: id, organizationId: orgId(req) })
    .select('+bank.accountHolder +bank.accountNumber +bank.ifsc +panNumber')
    .populate('departmentId', 'name code')
    .populate('designationId', 'title')
    .populate('managerId', 'firstName lastName employeeCode');
  if (!e) throw notFound('Employee not found');
  const obj = e.toObject({ virtuals: false });
  const sensitive = canSeeSensitive(req, id);
  const { bank: b, panNumber, ...rest } = obj as typeof obj & { bank?: { accountHolder?: string; accountNumber?: string; ifsc?: string } };
  return {
    ...rest,
    ...(sensitive ? { bank: b ? { accountHolder: b.accountHolder, accountNumberMasked: mask(b.accountNumber), ifsc: b.ifsc } : undefined, panMasked: mask(panNumber) } : {}),
  };
}

async function validateRefs(req: Request, b: Partial<z.infer<typeof employeeBody>>, selfId?: string) {
  const org = orgId(req);
  if (b.departmentId && !(await Department.exists({ _id: b.departmentId, organizationId: org }))) throw badRequest('Unknown department');
  if (b.designationId && !(await Designation.exists({ _id: b.designationId, organizationId: org }))) throw badRequest('Unknown designation');
  if (b.managerId) {
    if (b.managerId === selfId) throw badRequest('An employee cannot be their own manager');
    if (!(await Employee.exists({ _id: b.managerId, organizationId: org }))) throw badRequest('Unknown manager');
    // Reject reporting cycles.
    let cursor: string | undefined = b.managerId;
    for (let i = 0; selfId && cursor && i < 50; i++) {
      const m = (await Employee.findById(cursor, { managerId: 1 }).lean()) as { managerId?: Types.ObjectId | null } | null;
      cursor = m?.managerId?.toString();
      if (cursor === selfId) throw badRequest('Reporting hierarchy would form a cycle');
    }
  }
}

const listQuery = paginationSchema.extend({
  q: z.string().max(100).optional(),
  departmentId: objectId.optional(),
  designationId: objectId.optional(),
  status: z.enum(EMPLOYMENT_STATUS).optional(),
  sort: z.enum(['employeeCode', 'firstName', 'joiningDate']).default('employeeCode'),
  order: z.enum(['asc', 'desc']).default('asc'),
});

async function buildFilter(req: Request, q: z.infer<typeof listQuery>) {
  const filter: Record<string, unknown> = await scopeFilter(req);
  if (q.departmentId) filter.departmentId = q.departmentId;
  if (q.designationId) filter.designationId = q.designationId;
  if (q.status) filter.status = q.status;
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q.trim()), 'i');
    filter.$or = [{ employeeCode: rx }, { firstName: rx }, { lastName: rx }, { workEmail: rx }];
  }
  return filter;
}

employeesRouter.get(
  '/',
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof listQuery>;
    const filter = await buildFilter(req, q);
    const [rows, total] = await Promise.all([
      Employee.find(filter)
        .sort({ [q.sort]: q.order === 'asc' ? 1 : -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .populate('departmentId', 'name code')
        .populate('designationId', 'title')
        .lean(),
      Employee.countDocuments(filter),
    ]);
    res.json({ data: rows, meta: pageMeta(q.page, q.limit, total) });
  }),
);

employeesRouter.get(
  '/export',
  requirePermission('employee:read'),
  validate({ query: listQuery.omit({ page: true, limit: true }) }),
  asyncHandler(async (req, res) => {
    const q = { ...(req.query as object), page: 1, limit: 100 } as z.infer<typeof listQuery>;
    const rows = await Employee.find(await buildFilter(req, q)).limit(10_000).populate('departmentId', 'name').populate('designationId', 'title').lean();
    const csv = stringify(
      rows.map((r) => ({
        employeeCode: r.employeeCode,
        name: `${r.firstName} ${r.lastName}`,
        workEmail: r.workEmail,
        department: (r.departmentId as unknown as { name?: string })?.name,
        designation: (r.designationId as unknown as { title?: string })?.title,
        status: r.status,
        joiningDate: r.joiningDate.toISOString().slice(0, 10),
        workLocation: r.workLocation,
      })),
      { header: true },
    );
    await audit(req, { action: 'employee.export', entityType: 'Employee', summary: { count: rows.length } });
    res.type('text/csv').attachment('employees.csv').send(csv);
  }),
);

employeesRouter.post(
  '/import',
  requirePermission('employee:write'),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw badRequest('CSV file is required (field name "file")');
    let records: Record<string, string>[];
    try {
      records = parse(req.file.buffer, { columns: true, skip_empty_lines: true, trim: true, bom: true, max_record_size: 4096 });
    } catch {
      throw badRequest('Could not parse CSV');
    }
    if (records.length > 1000) throw badRequest('Import limited to 1000 rows');

    const org = orgId(req);
    const [depts, desigs] = await Promise.all([Department.find({ organizationId: org }).lean(), Designation.find({ organizationId: org }).lean()]);
    const rowSchema = z.object({
      firstName: z.string().min(1).max(100),
      lastName: z.string().min(1).max(100),
      workEmail: z.string().email(),
      department: z.string().min(1),
      designation: z.string().min(1),
      joiningDate: z.coerce.date(),
      workLocation: z.string().min(1),
      employmentType: z.enum(EMPLOYMENT_TYPE).default('full_time'),
      managerEmployeeCode: z.string().optional(),
    });

    const errors: { row: number; message: string }[] = [];
    let created = 0;
    const seenEmails = new Set<string>();
    for (const [i, rec] of records.entries()) {
      const row = i + 2; // header is row 1
      const parsed = rowSchema.safeParse({ ...rec, employmentType: rec.employmentType || undefined });
      if (!parsed.success) {
        errors.push({ row, message: parsed.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ') });
        continue;
      }
      const d = parsed.data;
      const dept = depts.find((x) => x.code === d.department.toUpperCase());
      const desig = desigs.find((x) => x.title.toLowerCase() === d.designation.toLowerCase());
      if (!dept) { errors.push({ row, message: `Unknown department code "${d.department}"` }); continue; }
      if (!desig) { errors.push({ row, message: `Unknown designation "${d.designation}"` }); continue; }
      const email = d.workEmail.toLowerCase();
      if (seenEmails.has(email)) { errors.push({ row, message: 'Duplicate email within file' }); continue; }
      seenEmails.add(email);
      let managerId: Types.ObjectId | undefined;
      if (d.managerEmployeeCode) {
        const m = await Employee.findOne({ organizationId: org, employeeCode: d.managerEmployeeCode }, { _id: 1 }).lean();
        if (!m) { errors.push({ row, message: `Unknown manager code "${d.managerEmployeeCode}"` }); continue; }
        managerId = m._id;
      }
      try {
        await Employee.create({ organizationId: org, employeeCode: await nextEmployeeCode(req.auth!.organizationId), firstName: d.firstName, lastName: d.lastName, workEmail: email, departmentId: dept._id, designationId: desig._id, managerId, joiningDate: d.joiningDate, workLocation: d.workLocation, employmentType: d.employmentType });
        created++;
      } catch (e) {
        errors.push({ row, message: (e as { code?: number }).code === 11000 ? 'Email already exists' : 'Could not save row' });
      }
    }
    await audit(req, { action: 'employee.import', entityType: 'Employee', summary: { created, failed: errors.length } });
    res.status(errors.length && !created ? 422 : 200).json({ data: { created, failed: errors.length, errors } });
  }),
);

employeesRouter.post(
  '/',
  requirePermission('employee:write'),
  validate({ body: employeeBody }),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof employeeBody>;
    await validateRefs(req, b);
    const doc = await Employee.create({ ...b, managerId: b.managerId ?? undefined, organizationId: orgId(req), employeeCode: await nextEmployeeCode(req.auth!.organizationId) });
    await audit(req, { action: 'employee.create', entityType: 'Employee', entityId: doc.id, summary: { employeeCode: doc.employeeCode, departmentId: b.departmentId, status: b.status } });
    res.status(201).json({ data: await present(req, doc.id) });
  }),
);

employeesRouter.get(
  '/:id',
  validate({ params: z.object({ id: objectId }) }),
  asyncHandler(async (req, res) => {
    await assertEmployeeAccess(req, req.params.id as string);
    res.json({ data: await present(req, req.params.id as string) });
  }),
);

employeesRouter.patch(
  '/:id',
  requirePermission('employee:write'),
  validate({ params: z.object({ id: objectId }), body: employeePatch }),
  asyncHandler(async (req, res) => {
    const id = req.params.id as string;
    const b = req.body as z.infer<typeof employeePatch>;
    const doc = await Employee.findOne({ _id: id, organizationId: orgId(req) });
    if (!doc) throw notFound('Employee not found');
    await validateRefs(req, b, id);
    const changed = Object.keys(b);
    const { bank: newBank, managerId, exitDate, ...rest } = b;
    Object.assign(doc, rest);
    if (managerId !== undefined) doc.managerId = (managerId ?? undefined) as never;
    if (exitDate !== undefined) doc.exitDate = (exitDate ?? undefined) as never;
    if (newBank) doc.set('bank', newBank);
    await doc.save();
    await audit(req, { action: 'employee.update', entityType: 'Employee', entityId: id, summary: { fields: changed } });
    res.json({ data: await present(req, id) });
  }),
);

employeesRouter.post(
  '/:id/deactivate',
  requirePermission('employee:write'),
  validate({ params: z.object({ id: objectId }), body: z.object({ exitDate: z.coerce.date(), reason: z.string().min(3).max(300) }) }),
  asyncHandler(async (req, res) => {
    const id = req.params.id as string;
    const doc = await Employee.findOne({ _id: id, organizationId: orgId(req) });
    if (!doc) throw notFound('Employee not found');
    if (doc.status === 'inactive') throw conflict('Employee is already inactive');
    const { exitDate, reason } = req.body as { exitDate: Date; reason: string };
    doc.status = 'inactive';
    doc.exitDate = exitDate;
    await doc.save();
    await audit(req, { action: 'employee.deactivate', entityType: 'Employee', entityId: id, summary: { exitDate, reason } });
    res.json({ data: await present(req, id) });
  }),
);

employeesRouter.get(
  '/:id/payroll-history',
  validate({ params: z.object({ id: objectId }) }),
  asyncHandler(async (req, res) => {
    const id = req.params.id as string;
    const isPayrollViewer = hasPermission(req.auth!.role, 'payroll:read');
    // Managers see employee records in scope but not their pay.
    if (!isPayrollViewer && req.auth!.employeeId !== id) throw notFound('Employee not found');
    await assertEmployeeAccess(req, id);
    const rows = await PayrollEntry.find({ organizationId: orgId(req), employeeId: id })
      .sort({ createdAt: -1 })
      .limit(60)
      .populate({ path: 'periodId', select: 'name status year month' })
      .lean();
    const visible = rows.filter((r) => FINALIZED.includes((r.periodId as unknown as { status: PayrollStatus })?.status) || isPayrollViewer);
    await audit(req, { action: 'employee.payroll_history_view', entityType: 'Employee', entityId: id });
    res.json({ data: visible.map((r) => ({ id: r._id, period: r.periodId, grossEarnings: r.grossEarnings, totalEmployeeDeductions: r.totalEmployeeDeductions, netPay: r.netPay, payableDays: r.payableDays })) });
  }),
);
