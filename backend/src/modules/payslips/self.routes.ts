import { Router, type Request } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { authenticate, orgId, requirePermission } from '../../middleware/auth.js';
import { asyncHandler, objectId, validate } from '../../middleware/common.js';
import { badRequest, conflict, forbidden, notFound } from '../../shared/errors.js';
import { pageMeta, paginationSchema } from '../../shared/pagination.js';
import { audit } from '../audit/audit.service.js';
import { Employee } from '../employees/employee.model.js';
import { assertEmployeeAccess, visibleEmployeeIds } from '../employees/scope.js';
import { Organization } from '../organizations/organization.model.js';
import { CorrectionRequest, PayrollEntry, PayrollPeriod, Payslip } from '../payroll/payroll.model.js';
import { FINALIZED } from '../payroll/state-machine.js';
import { SalaryRevision } from '../salary-structures/salary.model.js';

export const selfRouter = Router();
selfRouter.use(authenticate);

function ownEmployeeId(req: Request): Types.ObjectId {
  if (!req.auth!.employeeId) throw forbidden('Your account is not linked to an employee record');
  return new Types.ObjectId(req.auth!.employeeId);
}

export const financialYearOf = (year: number, month: number, startMonth: number) => (month >= startMonth ? year : year - 1);

async function finalizedEntries(req: Request, employeeId: Types.ObjectId) {
  const [org, periods] = await Promise.all([
    Organization.findById(orgId(req), { financialYearStartMonth: 1 }).lean(),
    PayrollPeriod.find({ organizationId: orgId(req), status: { $in: FINALIZED } }).sort({ year: -1, month: -1 }).lean(),
  ]);
  const startMonth = org?.financialYearStartMonth ?? 4;
  const byId = new Map(periods.map((p) => [p._id.toString(), p]));
  const entries = await PayrollEntry.find({ organizationId: orgId(req), employeeId, periodId: { $in: periods.map((p) => p._id) }, payable: true }).lean();
  return entries
    .map((e) => {
      const p = byId.get(e.periodId.toString())!;
      return { entry: e, period: p, fy: financialYearOf(p.year, p.month, startMonth) };
    })
    .sort((a, b) => b.period.year * 12 + b.period.month - (a.period.year * 12 + a.period.month));
}

selfRouter.get('/profile', asyncHandler(async (req, res) => {
  const id = ownEmployeeId(req);
  const emp = await Employee.findOne({ _id: id, organizationId: orgId(req) }).populate('departmentId', 'name').populate('designationId', 'title').lean();
  if (!emp) throw notFound('Employee not found');
  const revision = await SalaryRevision.findOne({ organizationId: orgId(req), employeeId: id, effectiveFrom: { $lte: new Date() } }).sort({ effectiveFrom: -1 }).lean();
  res.json({ data: { employee: emp, salary: revision ? { annualCtc: revision.annualCtc, effectiveFrom: revision.effectiveFrom, components: revision.components } : null } });
}));

selfRouter.get('/dashboard', asyncHandler(async (req, res) => {
  const id = ownEmployeeId(req);
  const rows = await finalizedEntries(req, id);
  const slips = await Payslip.find({ organizationId: orgId(req), employeeId: id }).sort({ createdAt: -1 }).limit(12).lean();
  const slipByPeriod = new Map(slips.map((s) => [s.periodId.toString(), s._id]));
  res.json({
    data: {
      netPayHistory: rows.slice(0, 12).reverse().map((r) => ({ period: r.period.name, year: r.period.year, month: r.period.month, net: r.entry.netPay, gross: r.entry.grossEarnings, deductions: r.entry.totalEmployeeDeductions, payslipId: slipByPeriod.get(r.period._id.toString()) ?? null })),
      latest: rows[0] ? { period: rows[0].period.name, net: rows[0].entry.netPay, gross: rows[0].entry.grossEarnings, earnings: [...rows[0].entry.earnings, ...rows[0].entry.additionalEarnings], deductions: rows[0].entry.employeeDeductions, payslipId: slipByPeriod.get(rows[0].period._id.toString()) ?? null } : null,
    },
  });
}));

selfRouter.get('/annual-summary', validate({ query: z.object({ fy: z.coerce.number().int().min(2000).max(2100).optional() }) }), asyncHandler(async (req, res) => {
  const id = ownEmployeeId(req);
  const rows = await finalizedEntries(req, id);
  const years = [...new Set(rows.map((r) => r.fy))].sort((a, b) => b - a);
  const fy = (req.query as { fy?: number }).fy ?? years[0];
  const sel = rows.filter((r) => r.fy === fy);
  const sum = (f: (e: (typeof rows)[number]['entry']) => number) => sel.reduce((a, r) => a + f(r.entry), 0);
  const deductionByCode = new Map<string, { name: string; total: number }>();
  for (const r of sel) for (const d of r.entry.employeeDeductions) {
    const cur = deductionByCode.get(d.code ?? '') ?? { name: d.name ?? '', total: 0 };
    cur.total += d.amount ?? 0;
    deductionByCode.set(d.code ?? '', cur);
  }
  res.json({ data: { financialYear: fy ?? null, availableYears: years, months: sel.length, gross: sum((e) => e.grossEarnings), deductions: sum((e) => e.totalEmployeeDeductions), net: sum((e) => e.netPay), deductionBreakdown: [...deductionByCode].map(([code, v]) => ({ code, ...v })) } });
}));

// ---------- Correction requests ----------

selfRouter.post(
  '/correction-requests',
  validate({ body: z.object({ subject: z.string().min(3).max(150), description: z.string().min(10).max(2000), periodId: objectId.optional() }) }),
  asyncHandler(async (req, res) => {
    const employeeId = ownEmployeeId(req);
    const b = req.body as { subject: string; description: string; periodId?: string };
    if (b.periodId && !(await PayrollPeriod.exists({ _id: b.periodId, organizationId: orgId(req) }))) throw badRequest('Unknown payroll period');
    const doc = await CorrectionRequest.create({ ...b, organizationId: orgId(req), employeeId });
    await audit(req, { action: 'correction_request.create', entityType: 'CorrectionRequest', entityId: doc.id, summary: { subject: b.subject } });
    res.status(201).json({ data: doc });
  }),
);

selfRouter.get('/correction-requests', validate({ query: paginationSchema }), asyncHandler(async (req, res) => {
  const { page, limit } = req.query as unknown as { page: number; limit: number };
  const filter = { organizationId: orgId(req), employeeId: ownEmployeeId(req) };
  const [rows, total] = await Promise.all([CorrectionRequest.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(), CorrectionRequest.countDocuments(filter)]);
  res.json({ data: rows, meta: pageMeta(page, limit, total) });
}));

/** Reviewer-side queue. Managers only see requests from their reporting scope. */
export const correctionReviewRouter = Router();
correctionReviewRouter.use(authenticate, requirePermission('request:review'));

correctionReviewRouter.get('/', validate({ query: paginationSchema.extend({ status: z.enum(['open', 'approved', 'rejected', 'resolved']).optional() }) }), asyncHandler(async (req, res) => {
  const q = req.query as unknown as { page: number; limit: number; status?: string };
  const ids = await visibleEmployeeIds(req);
  const filter: Record<string, unknown> = { organizationId: orgId(req), ...(q.status ? { status: q.status } : {}), ...(ids ? { employeeId: { $in: ids } } : {}) };
  const [rows, total] = await Promise.all([
    CorrectionRequest.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).populate('employeeId', 'employeeCode firstName lastName').lean(),
    CorrectionRequest.countDocuments(filter),
  ]);
  res.json({ data: rows, meta: pageMeta(q.page, q.limit, total) });
}));

correctionReviewRouter.patch(
  '/:id',
  validate({ params: z.object({ id: objectId }), body: z.object({ status: z.enum(['approved', 'rejected', 'resolved']), reviewNote: z.string().min(3).max(1000) }) }),
  asyncHandler(async (req, res) => {
    const doc = await CorrectionRequest.findOne({ _id: req.params.id, organizationId: orgId(req) });
    if (!doc) throw notFound('Request not found');
    await assertEmployeeAccess(req, doc.employeeId.toString());
    if (req.auth!.employeeId === doc.employeeId.toString()) throw forbidden('You cannot review your own request');
    if (doc.status === 'rejected' || doc.status === 'resolved') throw conflict('Request is already closed');
    const b = req.body as { status: 'approved' | 'rejected' | 'resolved'; reviewNote: string };
    doc.status = b.status;
    doc.reviewNote = b.reviewNote;
    doc.reviewedBy = new Types.ObjectId(req.auth!.userId);
    await doc.save();
    await audit(req, { action: 'correction_request.review', entityType: 'CorrectionRequest', entityId: doc.id, summary: { status: b.status } });
    res.json({ data: doc });
  }),
);
