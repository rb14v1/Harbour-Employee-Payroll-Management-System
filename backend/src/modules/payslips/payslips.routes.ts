import { Router, type Request } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { authenticate, orgId } from '../../middleware/auth.js';
import { asyncHandler, objectId, validate } from '../../middleware/common.js';
import { forbidden, notFound } from '../../shared/errors.js';
import { pageMeta, paginationSchema } from '../../shared/pagination.js';
import { hasPermission } from '../../shared/permissions.js';
import { audit } from '../audit/audit.service.js';
import { Employee } from '../employees/employee.model.js';
import { Organization } from '../organizations/organization.model.js';
import { PaymentRecord, PayrollEntry, PayrollPeriod, Payslip } from '../payroll/payroll.model.js';
import { renderPayslip } from './payslip.pdf.js';

export const payslipsRouter = Router();
payslipsRouter.use(authenticate);

/** Employees see only their own payslips; payslip:read_any roles see the organisation's. Everyone else is refused. */
function scopeOrThrow(req: Request): Record<string, unknown> {
  const a = req.auth!;
  if (hasPermission(a.role, 'payslip:read_any')) return { organizationId: orgId(req) };
  if (a.employeeId) return { organizationId: orgId(req), employeeId: new Types.ObjectId(a.employeeId) };
  throw forbidden();
}

payslipsRouter.get(
  '/',
  validate({ query: paginationSchema.extend({ employeeId: objectId.optional(), periodId: objectId.optional() }) }),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as { page: number; limit: number; employeeId?: string; periodId?: string };
    const filter: Record<string, unknown> = scopeOrThrow(req);
    if (q.employeeId && hasPermission(req.auth!.role, 'payslip:read_any')) filter.employeeId = new Types.ObjectId(q.employeeId);
    if (q.periodId) filter.periodId = new Types.ObjectId(q.periodId);
    const [rows, total] = await Promise.all([
      Payslip.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).populate('entryId', 'snapshot grossEarnings netPay totalEmployeeDeductions').lean(),
      Payslip.countDocuments(filter),
    ]);
    res.json({ data: rows, meta: pageMeta(q.page, q.limit, total) });
  }),
);

async function loadOwned(req: Request) {
  const slip = await Payslip.findOne({ _id: req.params.id, ...scopeOrThrow(req) });
  if (!slip) throw notFound('Payslip not found');
  return slip;
}

payslipsRouter.get('/:id', validate({ params: z.object({ id: objectId }) }), asyncHandler(async (req, res) => {
  const slip = await loadOwned(req);
  const entry = await PayrollEntry.findById(slip.entryId).lean();
  const payment = await PaymentRecord.findOne({ periodId: slip.periodId }).lean();
  res.json({ data: { payslip: slip, entry, payment: payment ? { reference: payment.reference, paymentDate: payment.paymentDate } : null } });
}));

payslipsRouter.get('/:id/pdf', validate({ params: z.object({ id: objectId }) }), asyncHandler(async (req, res) => {
  const slip = await loadOwned(req);
  const [entry, period, org, payment] = await Promise.all([
    PayrollEntry.findById(slip.entryId).lean(),
    PayrollPeriod.findById(slip.periodId).lean(),
    Organization.findById(slip.organizationId).lean(),
    PaymentRecord.findOne({ periodId: slip.periodId }).lean(),
  ]);
  if (!entry || !period || !org) throw notFound('Payslip data unavailable');
  const emp = await Employee.findById(slip.employeeId, { employeeCode: 1 }).lean();
  const pdf = await renderPayslip({
    organizationName: org.name,
    logoText: org.logoText ?? undefined,
    employeeName: entry.snapshot?.name ?? '',
    employeeCode: emp?.employeeCode ?? entry.snapshot?.employeeCode ?? '',
    department: entry.snapshot?.departmentName ?? '',
    designation: entry.snapshot?.designation ?? '',
    periodName: period.name,
    periodStart: period.startDate,
    periodEnd: period.endDate,
    paidDays: entry.payableDays ?? 0,
    totalDays: entry.totalDays ?? 0,
    earnings: [...entry.earnings, ...entry.additionalEarnings].map((l) => ({ name: l.name ?? '', amount: l.amount ?? 0 })),
    deductions: entry.employeeDeductions.map((l) => ({ name: l.name ?? '', amount: l.amount ?? 0 })),
    employerContributions: entry.employerContributions.map((l) => ({ name: l.name ?? '', amount: l.amount ?? 0 })),
    gross: entry.grossEarnings,
    totalDeductions: entry.totalEmployeeDeductions,
    net: entry.netPay,
    paymentDate: payment?.paymentDate,
    paymentReference: payment?.reference,
    isDemo: slip.isDemo || org.isDemo,
  });
  await audit(req, { action: 'payslip.download', entityType: 'Payslip', entityId: slip.id, summary: { employeeId: slip.employeeId, period: period.name } });
  res
    .status(200)
    .set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="payslip-${period.year}-${String(period.month).padStart(2, '0')}.pdf"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' })
    .send(pdf);
}));
