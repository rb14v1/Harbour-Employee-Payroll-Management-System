import { Router, type Request } from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import { Types, type ClientSession } from 'mongoose';
import { z } from 'zod';
import { supportsTransactions, withTransaction } from '../../config/db.js';
import { authenticate, orgId, requirePermission } from '../../middleware/auth.js';
import { asyncHandler, objectId, validate } from '../../middleware/common.js';
import { badRequest, conflict, forbidden, notFound } from '../../shared/errors.js';
import { rupeesToPaise } from '../../shared/money.js';
import { pageMeta, paginationSchema } from '../../shared/pagination.js';
import { audit } from '../audit/audit.service.js';
import { Employee } from '../employees/employee.model.js';
import { Organization } from '../organizations/organization.model.js';
import { computePeriod, totalsOf } from './payroll.service.js';
import { ApprovalRecord, INPUT_TYPES, PaymentRecord, PayrollAdjustment, PayrollEntry, PayrollInput, PayrollPeriod, Payslip } from './payroll.model.js';
import { EDITABLE, PAYROLL_STATUSES, FINALIZED, type PayrollStatus } from './state-machine.js';

export const payrollRouter = Router();
payrollRouter.use(authenticate);

const periodParams = z.object({ periodId: objectId });
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024, files: 1 },
  fileFilter: (_r, f, cb) => {
    if (/\.csv$/i.test(f.originalname)) cb(null, true);
    else cb(badRequest('Only .csv files are accepted'));
  },
});

async function getPeriod(req: Request, id = req.params.periodId as string) {
  const p = await PayrollPeriod.findOne({ _id: id, organizationId: orgId(req) });
  if (!p) throw notFound('Payroll period not found');
  return p;
}

/** Atomic guarded transition. Only one concurrent caller can move the batch out of `from`. */
async function transition(req: Request, from: readonly PayrollStatus[], to: PayrollStatus, set: Record<string, unknown> = {}, session?: ClientSession) {
  const doc = await PayrollPeriod.findOneAndUpdate(
    { _id: req.params.periodId, organizationId: orgId(req), status: { $in: from } },
    { $set: { status: to, ...set } },
    { returnDocument: 'after', session },
  );
  if (!doc) {
    const current = await PayrollPeriod.findOne({ _id: req.params.periodId, organizationId: orgId(req) }, { status: 1 }).lean();
    if (!current) throw notFound('Payroll period not found');
    throw conflict(`Action not allowed while payroll is "${current.status}"`, { status: current.status, allowedFrom: from });
  }
  return doc;
}

type ApprovalAction = 'calculate' | 'submit' | 'approve' | 'reject' | 'finalize' | 'payment' | 'recalculate' | 'cancel';
const record = (req: Request, periodId: Types.ObjectId, action: ApprovalAction, from: string, to: string, comment?: string, totals?: unknown) => ({
  organizationId: orgId(req),
  periodId,
  action,
  actorId: req.auth!.userId,
  actorRole: req.auth!.role,
  comment,
  fromStatus: from,
  toStatus: to,
  totalsSnapshot: totals,
});

async function assertSegregation(req: Request, period: { preparedBy?: Types.ObjectId | null }) {
  const org = await Organization.findById(orgId(req), { settings: 1 }).lean();
  if (org?.settings?.segregationOfDuties === false) return;
  const preparers = await ApprovalRecord.find({ periodId: req.params.periodId, action: { $in: ['submit', 'calculate', 'recalculate'] } }, { actorId: 1 }).lean();
  const ids = new Set([...preparers.map((p) => p.actorId.toString()), period.preparedBy?.toString()].filter(Boolean));
  if (ids.has(req.auth!.userId)) throw forbidden('Segregation of duties: the preparer cannot approve this payroll batch');
}

// ---------- Periods ----------

payrollRouter.get('/periods', requirePermission('payroll:read'), validate({ query: paginationSchema.extend({ status: z.enum(PAYROLL_STATUSES).optional() }) }), asyncHandler(async (req, res) => {
  const q = req.query as unknown as { page: number; limit: number; status?: PayrollStatus };
  const filter = { organizationId: orgId(req), ...(q.status ? { status: q.status } : {}) };
  const [rows, total] = await Promise.all([
    PayrollPeriod.find(filter).sort({ year: -1, month: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean(),
    PayrollPeriod.countDocuments(filter),
  ]);
  res.json({ data: rows, meta: pageMeta(q.page, q.limit, total) });
}));

payrollRouter.post(
  '/periods',
  requirePermission('payroll:prepare'),
  validate({ body: z.object({ year: z.number().int().min(2000).max(2100), month: z.number().int().min(1).max(12), cutoffDate: z.coerce.date().optional() }) }),
  asyncHandler(async (req, res) => {
    const { year, month, cutoffDate } = req.body as { year: number; month: number; cutoffDate?: Date };
    const startDate = new Date(Date.UTC(year, month - 1, 1));
    const endDate = new Date(Date.UTC(year, month, 0));
    const name = startDate.toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const doc = await PayrollPeriod.create({ organizationId: orgId(req), name, year, month, startDate, endDate, cutoffDate: cutoffDate ?? endDate, preparedBy: req.auth!.userId });
    await audit(req, { action: 'payroll.period_create', entityType: 'PayrollPeriod', entityId: doc.id, summary: { name } });
    res.status(201).json({ data: doc });
  }),
);

// ---------- Inputs ----------

const inputBody = z.object({
  employeeId: objectId,
  type: z.enum(INPUT_TYPES),
  value: z.number().min(0).max(Number.MAX_SAFE_INTEGER),
  description: z.string().max(300).optional(),
});

function checkInputValue(type: string, value: number) {
  if (type === 'unpaid_leave') {
    if ((value * 2) % 1 !== 0 || value > 31) throw badRequest('Unpaid leave must be whole or half days (max 31)');
  } else if (!Number.isSafeInteger(value)) throw badRequest('Monetary inputs must be integer paise');
}

payrollRouter.get('/:periodId/inputs', requirePermission('input:read'), validate({ params: periodParams, query: paginationSchema.extend({ employeeId: objectId.optional(), status: z.enum(['pending', 'approved', 'rejected']).optional() }) }), asyncHandler(async (req, res) => {
  const q = req.query as unknown as { page: number; limit: number; employeeId?: string; status?: 'pending' | 'approved' | 'rejected' };
  const filter = { organizationId: orgId(req), periodId: req.params.periodId, ...(q.employeeId ? { employeeId: q.employeeId } : {}), ...(q.status ? { status: q.status } : {}) };
  const [rows, total] = await Promise.all([
    PayrollInput.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).populate('employeeId', 'employeeCode firstName lastName').lean(),
    PayrollInput.countDocuments(filter),
  ]);
  res.json({ data: rows, meta: pageMeta(q.page, q.limit, total) });
}));

payrollRouter.post('/:periodId/inputs', requirePermission('input:manage'), validate({ params: periodParams, body: inputBody }), asyncHandler(async (req, res) => {
  const period = await getPeriod(req);
  if (!EDITABLE.includes(period.status as PayrollStatus)) throw conflict(`Inputs are locked while payroll is "${period.status}"`);
  const b = req.body as z.infer<typeof inputBody>;
  checkInputValue(b.type, b.value);
  if (!(await Employee.exists({ _id: b.employeeId, organizationId: orgId(req) }))) throw badRequest('Unknown employee');
  const doc = await PayrollInput.create({ ...b, organizationId: orgId(req), periodId: period._id, source: 'manual', enteredBy: req.auth!.userId });
  await audit(req, { action: 'payroll.input_create', entityType: 'PayrollInput', entityId: doc.id, summary: { periodId: period.id, type: b.type, employeeId: b.employeeId } });
  res.status(201).json({ data: doc });
}));

payrollRouter.post('/:periodId/inputs/import', requirePermission('input:manage'), validate({ params: periodParams }), upload.single('file'), asyncHandler(async (req, res) => {
  const period = await getPeriod(req);
  if (!EDITABLE.includes(period.status as PayrollStatus)) throw conflict(`Inputs are locked while payroll is "${period.status}"`);
  if (!req.file) throw badRequest('CSV file is required (field name "file")');
  let rows: Record<string, string>[];
  try {
    rows = parse(req.file.buffer, { columns: true, skip_empty_lines: true, trim: true, bom: true });
  } catch {
    throw badRequest('Could not parse CSV');
  }
  if (rows.length > 2000) throw badRequest('Import limited to 2000 rows');
  const emps = await Employee.find({ organizationId: orgId(req) }, { employeeCode: 1 }).lean();
  const byCode = new Map(emps.map((e) => [e.employeeCode, e._id]));
  const errors: { row: number; message: string }[] = [];
  const docs: object[] = [];
  rows.forEach((r, i) => {
    const row = i + 2;
    const empId = byCode.get(r.employeeCode ?? '');
    const type = r.type as (typeof INPUT_TYPES)[number];
    if (!empId) return void errors.push({ row, message: `Unknown employeeCode "${r.employeeCode}"` });
    if (!INPUT_TYPES.includes(type)) return void errors.push({ row, message: `Invalid type "${r.type}"` });
    try {
      const value = type === 'unpaid_leave' ? Number(r.value) : rupeesToPaise(r.value ?? '');
      if (!Number.isFinite(value) || value < 0) throw new Error('Value must be a non-negative number');
      checkInputValue(type, value);
      docs.push({ organizationId: orgId(req), periodId: period._id, employeeId: empId, type, value, description: r.description?.slice(0, 300), source: 'csv_import', enteredBy: req.auth!.userId });
    } catch (e) {
      errors.push({ row, message: (e as Error).message });
    }
  });
  // All-or-nothing: a file with any invalid row is rejected so partial data never enters payroll.
  if (errors.length) return void res.status(422).json({ error: { code: 'IMPORT_INVALID', message: 'Import rejected; fix the listed rows and retry', details: errors } });
  await PayrollInput.insertMany(docs);
  await audit(req, { action: 'payroll.input_import', entityType: 'PayrollPeriod', entityId: period.id, summary: { created: docs.length } });
  res.status(201).json({ data: { created: docs.length } });
}));

payrollRouter.post(
  '/inputs/:inputId/review',
  requirePermission('input:manage'),
  validate({ params: z.object({ inputId: objectId }), body: z.object({ decision: z.enum(['approved', 'rejected']), note: z.string().max(300).optional() }) }),
  asyncHandler(async (req, res) => {
    const input = await PayrollInput.findOne({ _id: req.params.inputId, organizationId: orgId(req) });
    if (!input) throw notFound('Input not found');
    const period = await PayrollPeriod.findById(input.periodId);
    if (!period || !EDITABLE.includes(period.status as PayrollStatus)) throw conflict('Inputs are locked for this payroll period');
    if (input.enteredBy.toString() === req.auth!.userId) throw forbidden('You cannot approve an input you entered');
    const { decision, note } = req.body as { decision: 'approved' | 'rejected'; note?: string };
    input.status = decision;
    input.approvedBy = new Types.ObjectId(req.auth!.userId);
    input.approvedAt = new Date();
    input.approvalNote = note;
    await input.save();
    await audit(req, { action: `payroll.input_${decision}`, entityType: 'PayrollInput', entityId: input.id, summary: { periodId: input.periodId, note } });
    res.json({ data: input });
  }),
);

// ---------- Calculation ----------

payrollRouter.post('/:periodId/simulate', requirePermission('payroll:prepare'), validate({ params: periodParams }), asyncHandler(async (req, res) => {
  const period = await getPeriod(req);
  if (period.status === 'cancelled') throw conflict('Payroll is cancelled');
  const { rows, policy } = await computePeriod(period);
  await audit(req, { action: 'payroll.simulate', entityType: 'PayrollPeriod', entityId: period.id });
  res.json({ data: { committed: false, policyVersion: policy?.version ?? null, policyIsTestOnly: policy?.isTestOnly ?? null, totals: totalsOf(rows), entries: rows.map((r) => ({ ...r.snapshot, ...r.result })) } });
}));

payrollRouter.post(
  '/:periodId/calculate',
  requirePermission('payroll:prepare'),
  validate({ params: periodParams, body: z.object({ reason: z.string().min(3).max(300).optional() }).default({}) }),
  asyncHandler(async (req, res) => {
    const existing = await getPeriod(req);
    const isRecalc = existing.calculationRun > 0;
    const reason = (req.body as { reason?: string }).reason;
    if (isRecalc && !reason) throw badRequest('A reason is required to recalculate payroll');

    const prev = existing.status;
    const period = await transition(req, ['draft', 'calculated', 'rejected'], 'processing');
    try {
      const { rows, policy } = await computePeriod(period);
      const now = new Date();
      const run = existing.calculationRun + 1;
      const ops = rows.map((r) => ({
        replaceOne: {
          filter: { periodId: period._id, employeeId: new Types.ObjectId(r.result.employeeId) },
          replacement: {
            organizationId: period.organizationId,
            periodId: period._id,
            employeeId: new Types.ObjectId(r.result.employeeId),
            snapshot: r.snapshot,
            policyVersionId: r.result.policyVersionId ? new Types.ObjectId(r.result.policyVersionId) : undefined,
            policyVersion: r.result.policyVersion,
            salaryRevisionId: r.salaryRevisionId ?? undefined,
            inputIds: r.inputIds,
            totalDays: r.result.totalDays,
            payableDays: r.result.payableDays,
            earnings: r.result.earnings,
            additionalEarnings: r.result.additionalEarnings,
            employeeDeductions: r.result.employeeDeductions,
            employerContributions: r.result.employerContributions,
            grossEarnings: r.result.grossEarnings,
            totalEmployeeDeductions: r.result.totalEmployeeDeductions,
            netPay: r.result.netPay,
            totalEmployerContributions: r.result.totalEmployerContributions,
            employerCost: r.result.employerCost,
            exceptions: r.result.exceptions,
            payable: r.result.payable,
            calculationRun: run,
            calculatedAt: now,
            calculatedBy: new Types.ObjectId(req.auth!.userId),
            createdAt: now,
            updatedAt: now,
          },
          upsert: true,
        },
      }));
      if (ops.length) await PayrollEntry.bulkWrite(ops as never);
      await PayrollEntry.deleteMany({ periodId: period._id, employeeId: { $nin: rows.map((r) => new Types.ObjectId(r.result.employeeId)) } });
      const totals = totalsOf(rows);
      const updated = await PayrollPeriod.findOneAndUpdate(
        { _id: period._id, status: 'processing' },
        { $set: { status: 'calculated', totals, calculationRun: run, policyVersionId: policy ? new Types.ObjectId(policy.id) : undefined } },
        { returnDocument: 'after' },
      );
      await ApprovalRecord.create(record(req, period._id, isRecalc ? 'recalculate' : 'calculate', prev, 'calculated', reason, totals));
      await audit(req, { action: isRecalc ? 'payroll.recalculate' : 'payroll.calculate', entityType: 'PayrollPeriod', entityId: period.id, summary: { run, reason, totals, policyVersion: policy?.version ?? null } });
      res.json({ data: updated });
    } catch (e) {
      // Restore the pre-run state so a failed run never strands the batch in "processing".
      await PayrollPeriod.updateOne({ _id: period._id, status: 'processing' }, { $set: { status: prev } });
      throw e;
    }
  }),
);

// ---------- Read models ----------

payrollRouter.get('/:periodId/summary', requirePermission('payroll:read'), validate({ params: periodParams }), asyncHandler(async (req, res) => {
  const period = await getPeriod(req);
  const [byDept, byDeduction, history] = await Promise.all([
    PayrollEntry.aggregate([
      { $match: { periodId: period._id, payable: true } },
      { $group: { _id: '$snapshot.departmentName', headcount: { $sum: 1 }, gross: { $sum: '$grossEarnings' }, net: { $sum: '$netPay' }, employerCost: { $sum: '$employerCost' } } },
      { $sort: { _id: 1 } },
    ]),
    PayrollEntry.aggregate([
      { $match: { periodId: period._id, payable: true } },
      { $unwind: '$employeeDeductions' },
      { $group: { _id: '$employeeDeductions.code', name: { $first: '$employeeDeductions.name' }, total: { $sum: '$employeeDeductions.amount' } } },
      { $sort: { _id: 1 } },
    ]),
    ApprovalRecord.find({ periodId: period._id }).sort({ createdAt: 1 }).lean(),
  ]);
  res.json({ data: { period, byDepartment: byDept.map((d) => ({ department: d._id, ...d, _id: undefined })), byDeduction: byDeduction.map((d) => ({ code: d._id, name: d.name, total: d.total })), history } });
}));

payrollRouter.get('/:periodId/entries', requirePermission('payroll:read'), validate({ params: periodParams, query: paginationSchema.extend({ exceptionsOnly: z.enum(['true', 'false']).optional(), q: z.string().max(100).optional() }) }), asyncHandler(async (req, res) => {
  const q = req.query as unknown as { page: number; limit: number; exceptionsOnly?: string; q?: string };
  const period = await getPeriod(req);
  const filter: Record<string, unknown> = { periodId: period._id, organizationId: orgId(req) };
  if (q.exceptionsOnly === 'true') filter['exceptions.0'] = { $exists: true };
  if (q.q) filter['snapshot.name'] = { $regex: q.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  const [rows, total] = await Promise.all([
    PayrollEntry.find(filter).sort({ 'snapshot.employeeCode': 1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean(),
    PayrollEntry.countDocuments(filter),
  ]);
  res.json({ data: rows, meta: pageMeta(q.page, q.limit, total) });
}));

payrollRouter.get('/:periodId/exceptions', requirePermission('payroll:read'), validate({ params: periodParams }), asyncHandler(async (req, res) => {
  const period = await getPeriod(req);
  const rows = await PayrollEntry.find({ periodId: period._id, 'exceptions.0': { $exists: true } }, { snapshot: 1, exceptions: 1, payable: 1, employeeId: 1 }).sort({ 'snapshot.employeeCode': 1 }).lean();
  res.json({ data: rows });
}));

// ---------- Workflow ----------

payrollRouter.post(
  '/:periodId/submit',
  requirePermission('payroll:prepare'),
  validate({ params: periodParams, body: z.object({ comment: z.string().max(1000).optional(), acknowledgeExceptions: z.boolean().default(false) }).default({ acknowledgeExceptions: false }) }),
  asyncHandler(async (req, res) => {
    const period = await getPeriod(req);
    if (period.status !== 'calculated') throw conflict(`Action not allowed while payroll is "${period.status}"`);
    const { comment, acknowledgeExceptions } = req.body as { comment?: string; acknowledgeExceptions: boolean };
    if ((period.totals?.payableCount ?? 0) === 0) throw conflict('No payable entries to submit');

    const sample = await PayrollEntry.findOne({ periodId: period._id }, { calculatedAt: 1 }).lean();
    if (sample?.calculatedAt && (await PayrollInput.exists({ periodId: period._id, updatedAt: { $gt: sample.calculatedAt } }))) {
      throw conflict('Payroll inputs changed since the last calculation; recalculate before submitting');
    }
    const errorEntries = await PayrollEntry.countDocuments({ periodId: period._id, payable: false });
    if (errorEntries > 0 && !acknowledgeExceptions) {
      throw conflict(`${errorEntries} employee(s) have blocking exceptions and will be excluded; resubmit with acknowledgeExceptions=true or fix them`, { errorEntries });
    }
    const updated = await transition(req, ['calculated'], 'pending_approval', { preparedBy: req.auth!.userId });
    await ApprovalRecord.create(record(req, period._id, 'submit', 'calculated', 'pending_approval', comment, updated.totals));
    await audit(req, { action: 'payroll.submit', entityType: 'PayrollPeriod', entityId: period.id, summary: { comment, excluded: errorEntries } });
    res.json({ data: updated });
  }),
);

payrollRouter.post(
  '/:periodId/approve',
  requirePermission('payroll:approve'),
  validate({ params: periodParams, body: z.object({ comment: z.string().max(1000).optional() }).default({}) }),
  asyncHandler(async (req, res) => {
    const period = await getPeriod(req);
    await assertSegregation(req, period);
    const updated = await transition(req, ['pending_approval'], 'approved', { approvedBy: req.auth!.userId, approvedAt: new Date() });
    await ApprovalRecord.create(record(req, period._id, 'approve', 'pending_approval', 'approved', (req.body as { comment?: string }).comment, updated.totals));
    await audit(req, { action: 'payroll.approve', entityType: 'PayrollPeriod', entityId: period.id, summary: { totals: updated.totals } });
    res.json({ data: updated });
  }),
);

payrollRouter.post(
  '/:periodId/reject',
  requirePermission('payroll:approve'),
  validate({ params: periodParams, body: z.object({ comment: z.string().min(3).max(1000) }) }),
  asyncHandler(async (req, res) => {
    const period = await getPeriod(req);
    await assertSegregation(req, period);
    const updated = await transition(req, ['pending_approval'], 'rejected');
    const comment = (req.body as { comment: string }).comment;
    await ApprovalRecord.create(record(req, period._id, 'reject', 'pending_approval', 'rejected', comment, updated.totals));
    await audit(req, { action: 'payroll.reject', entityType: 'PayrollPeriod', entityId: period.id, summary: { comment } });
    res.json({ data: updated });
  }),
);

payrollRouter.post(
  '/:periodId/finalize',
  requirePermission('payroll:finalize'),
  validate({ params: periodParams }),
  asyncHandler(async (req, res) => {
    const org = await Organization.findById(orgId(req), { isDemo: 1 }).lean();
    let transitioned = false;
    const run = async (session?: ClientSession) => {
      const updated = await transition(req, ['approved'], 'payment_processing', { finalizedAt: new Date(), finalizedBy: req.auth!.userId, paymentStatus: 'processing' }, session);
      transitioned = true;
      const entries = await PayrollEntry.find({ periodId: updated._id, payable: true }, { employeeId: 1 }).session(session ?? null).lean();
      await Payslip.insertMany(
        entries.map((e) => ({ organizationId: updated.organizationId, periodId: updated._id, employeeId: e.employeeId, entryId: e._id, periodName: updated.name, isDemo: Boolean(org?.isDemo) })),
        { session, ordered: true },
      );
      await PayrollAdjustment.updateMany({ targetPeriodId: updated._id, status: 'approved' }, { status: 'applied' }, { session });
      await ApprovalRecord.create([record(req, updated._id, 'finalize', 'approved', 'payment_processing', undefined, updated.totals)], { session });
      return { updated, count: entries.length };
    };
    let result;
    try {
      result = await withTransaction(run);
    } catch (e) {
      // Standalone MongoDB has no transactions: undo only what this request itself changed so it can be retried.
      // (With a replica set the transaction has already rolled back.) Losers of a race never reach `transitioned`.
      if (transitioned && !(await supportsTransactions())) {
        await Payslip.deleteMany({ periodId: req.params.periodId, organizationId: orgId(req) });
        await PayrollPeriod.updateOne({ _id: req.params.periodId, organizationId: orgId(req), status: 'payment_processing' }, { $set: { status: 'approved', paymentStatus: 'not_started' }, $unset: { finalizedAt: '', finalizedBy: '' } });
      }
      throw e;
    }
    await audit(req, { action: 'payroll.finalize', entityType: 'PayrollPeriod', entityId: result.updated.id, summary: { payslips: result.count } });
    res.json({ data: result.updated });
  }),
);

payrollRouter.post(
  '/:periodId/payment-reference',
  requirePermission('payment:record'),
  validate({ params: periodParams, body: z.object({ reference: z.string().min(3).max(100), paymentDate: z.coerce.date(), amount: z.number().int().min(0), method: z.string().max(40).optional() }) }),
  asyncHandler(async (req, res) => {
    const b = req.body as { reference: string; paymentDate: Date; amount: number; method?: string };
    const period = await getPeriod(req);
    if (period.status !== 'payment_processing') throw conflict(`Action not allowed while payroll is "${period.status}"`);
    const expectedNet = period.totals?.net ?? 0;
    if (b.amount !== expectedNet) throw badRequest(`Payment amount must equal batch net payable (${expectedNet} paise)`);
    const updated = await transition(req, ['payment_processing'], 'reconciliation_pending', { paymentStatus: 'paid', reconciliationStatus: 'pending' });
    const pay = await PaymentRecord.create({ ...b, organizationId: orgId(req), periodId: period._id, recordedBy: req.auth!.userId });
    await ApprovalRecord.create(record(req, period._id, 'payment', 'payment_processing', 'reconciliation_pending', `Payment ref ${b.reference}`));
    await audit(req, { action: 'payroll.payment_recorded', entityType: 'PayrollPeriod', entityId: period.id, summary: { reference: b.reference, amount: b.amount } });
    res.status(201).json({ data: { period: updated, payment: pay } });
  }),
);

payrollRouter.post(
  '/:periodId/reconcile',
  requirePermission('payment:record'),
  validate({ params: periodParams, body: z.object({ note: z.string().max(500).optional() }).default({}) }),
  asyncHandler(async (req, res) => {
    const updated = await transition(req, ['reconciliation_pending'], 'reconciled', { reconciliationStatus: 'reconciled' });
    await PaymentRecord.updateMany({ periodId: updated._id }, { reconciledBy: req.auth!.userId, reconciledAt: new Date(), reconciliationNote: (req.body as { note?: string }).note });
    await audit(req, { action: 'payroll.reconciled', entityType: 'PayrollPeriod', entityId: updated.id });
    res.json({ data: updated });
  }),
);

payrollRouter.post(
  '/:periodId/cancel',
  requirePermission('payroll:prepare'),
  validate({ params: periodParams, body: z.object({ reason: z.string().min(3).max(300) }) }),
  asyncHandler(async (req, res) => {
    const period = await getPeriod(req);
    const updated = await transition(req, ['draft', 'calculated', 'rejected'], 'cancelled');
    await ApprovalRecord.create(record(req, period._id, 'cancel', period.status, 'cancelled', (req.body as { reason: string }).reason));
    await audit(req, { action: 'payroll.cancel', entityType: 'PayrollPeriod', entityId: period.id, summary: req.body });
    res.json({ data: updated });
  }),
);

// ---------- Post-finalisation adjustments ----------

payrollRouter.post(
  '/:periodId/adjustments',
  requirePermission('payroll:prepare'),
  validate({ params: periodParams, body: z.object({ employeeId: objectId, targetPeriodId: objectId, amount: z.number().int().refine((n) => n !== 0, 'Amount cannot be zero'), reason: z.string().min(3).max(500) }) }),
  asyncHandler(async (req, res) => {
    const b = req.body as { employeeId: string; targetPeriodId: string; amount: number; reason: string };
    const original = await getPeriod(req);
    if (!FINALIZED.includes(original.status as PayrollStatus)) throw conflict('Adjustments apply only to finalised payroll; edit the batch directly instead');
    const target = await PayrollPeriod.findOne({ _id: b.targetPeriodId, organizationId: orgId(req) });
    if (!target || target.id === original.id || !EDITABLE.includes(target.status as PayrollStatus)) throw badRequest('Target period must be a different, editable payroll period');
    if (!(await PayrollEntry.exists({ periodId: original._id, employeeId: b.employeeId }))) throw badRequest('Employee has no entry in the original period');
    const doc = await PayrollAdjustment.create({ organizationId: orgId(req), originalPeriodId: original._id, employeeId: b.employeeId, targetPeriodId: target._id, amount: b.amount, reason: b.reason, requestedBy: req.auth!.userId });
    await audit(req, { action: 'payroll.adjustment_request', entityType: 'PayrollAdjustment', entityId: doc.id, summary: { amount: b.amount, originalPeriodId: original.id, targetPeriodId: target.id } });
    res.status(201).json({ data: doc });
  }),
);

payrollRouter.post(
  '/adjustments/:id/review',
  requirePermission('payroll:approve'),
  validate({ params: z.object({ id: objectId }), body: z.object({ decision: z.enum(['approved', 'rejected']) }) }),
  asyncHandler(async (req, res) => {
    const adj = await PayrollAdjustment.findOne({ _id: req.params.id, organizationId: orgId(req), status: 'pending' });
    if (!adj) throw notFound('Pending adjustment not found');
    if (adj.requestedBy.toString() === req.auth!.userId) throw forbidden('You cannot review an adjustment you requested');
    adj.status = (req.body as { decision: 'approved' | 'rejected' }).decision;
    adj.approvedBy = new Types.ObjectId(req.auth!.userId);
    await adj.save();
    await audit(req, { action: `payroll.adjustment_${adj.status}`, entityType: 'PayrollAdjustment', entityId: adj.id });
    res.json({ data: adj });
  }),
);

