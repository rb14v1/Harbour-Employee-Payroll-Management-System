import { Schema, model } from 'mongoose';
import { PAYROLL_STATUSES } from './state-machine.js';

const oid = (ref: string, required = false) => ({ type: Schema.Types.ObjectId, ref, required });

const periodSchema = new Schema(
  {
    organizationId: oid('Organization', true),
    name: { type: String, required: true, trim: true },
    year: { type: Number, required: true },
    month: { type: Number, required: true, min: 1, max: 12 },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    cutoffDate: { type: Date, required: true },
    status: { type: String, enum: PAYROLL_STATUSES, default: 'draft' },
    paymentStatus: { type: String, enum: ['not_started', 'processing', 'paid'], default: 'not_started' },
    reconciliationStatus: { type: String, enum: ['not_started', 'pending', 'reconciled'], default: 'not_started' },
    preparedBy: oid('User'),
    approvedBy: oid('User'),
    approvedAt: Date,
    finalizedAt: Date,
    finalizedBy: oid('User'),
    policyVersionId: oid('PayrollPolicyVersion'),
    calculationRun: { type: Number, default: 0 },
    totals: {
      employeeCount: { type: Number, default: 0 },
      payableCount: { type: Number, default: 0 },
      exceptionCount: { type: Number, default: 0 },
      gross: { type: Number, default: 0 },
      deductions: { type: Number, default: 0 },
      net: { type: Number, default: 0 },
      employerContributions: { type: Number, default: 0 },
      employerCost: { type: Number, default: 0 },
    },
    isDemo: { type: Boolean, default: false },
  },
  { timestamps: true, optimisticConcurrency: true },
);
periodSchema.index({ organizationId: 1, year: 1, month: 1 }, { unique: true });
periodSchema.index({ organizationId: 1, status: 1 });

export const PayrollPeriod = model('PayrollPeriod', periodSchema);

const line = new Schema({ code: String, name: String, amount: Number }, { _id: false });
const exception = new Schema({ code: String, severity: String, message: String }, { _id: false });

const entrySchema = new Schema(
  {
    organizationId: oid('Organization', true),
    periodId: oid('PayrollPeriod', true),
    employeeId: oid('Employee', true),
    // Snapshot of employee context at calculation time.
    snapshot: {
      employeeCode: String,
      name: String,
      departmentId: oid('Department'),
      departmentName: String,
      designation: String,
      workLocation: String,
    },
    policyVersionId: oid('PayrollPolicyVersion'),
    policyVersion: Number,
    salaryRevisionId: oid('SalaryRevision'),
    inputIds: [oid('PayrollInput')],
    totalDays: Number,
    payableDays: Number,
    earnings: [line],
    additionalEarnings: [line],
    employeeDeductions: [line],
    employerContributions: [line],
    grossEarnings: { type: Number, default: 0 },
    totalEmployeeDeductions: { type: Number, default: 0 },
    netPay: { type: Number, default: 0 },
    totalEmployerContributions: { type: Number, default: 0 },
    employerCost: { type: Number, default: 0 },
    exceptions: [exception],
    payable: { type: Boolean, default: false },
    calculationRun: Number,
    calculatedAt: Date,
    calculatedBy: oid('User'),
  },
  { timestamps: true },
);
// One entry per employee per period: duplicate payroll processing is prevented by the DB.
entrySchema.index({ periodId: 1, employeeId: 1 }, { unique: true });
entrySchema.index({ organizationId: 1, employeeId: 1, createdAt: -1 });
entrySchema.index({ organizationId: 1, periodId: 1, 'snapshot.departmentId': 1 });

export const PayrollEntry = model('PayrollEntry', entrySchema);

export const INPUT_TYPES = ['unpaid_leave', 'overtime', 'variable_pay', 'incentive', 'deduction', 'adjustment'] as const;

const inputSchema = new Schema(
  {
    organizationId: oid('Organization', true),
    periodId: oid('PayrollPeriod', true),
    employeeId: oid('Employee', true),
    type: { type: String, enum: INPUT_TYPES, required: true },
    // days for unpaid_leave, paise for monetary types
    value: { type: Number, required: true, min: 0 },
    description: { type: String, maxlength: 300 },
    source: { type: String, enum: ['manual', 'csv_import', 'integration'], default: 'manual' },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    enteredBy: oid('User', true),
    approvedBy: oid('User'),
    approvedAt: Date,
    approvalNote: String,
  },
  { timestamps: true },
);
inputSchema.index({ organizationId: 1, periodId: 1, employeeId: 1 });

export const PayrollInput = model('PayrollInput', inputSchema);

// Post-finalisation corrections, applied to a later period via a controlled workflow.
const adjustmentSchema = new Schema(
  {
    organizationId: oid('Organization', true),
    originalPeriodId: oid('PayrollPeriod', true),
    employeeId: oid('Employee', true),
    targetPeriodId: oid('PayrollPeriod'),
    amount: { type: Number, required: true },
    reason: { type: String, required: true, maxlength: 500 },
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'applied'], default: 'pending' },
    requestedBy: oid('User', true),
    approvedBy: oid('User'),
  },
  { timestamps: true },
);
export const PayrollAdjustment = model('PayrollAdjustment', adjustmentSchema);

// Append-only approval history.
const approvalSchema = new Schema(
  {
    organizationId: oid('Organization', true),
    periodId: oid('PayrollPeriod', true),
    action: { type: String, enum: ['calculate', 'submit', 'approve', 'reject', 'finalize', 'payment', 'recalculate', 'cancel'], required: true },
    actorId: oid('User', true),
    actorRole: String,
    comment: { type: String, maxlength: 1000 },
    fromStatus: String,
    toStatus: String,
    totalsSnapshot: Schema.Types.Mixed,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
approvalSchema.index({ periodId: 1, createdAt: 1 });
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'findOneAndDelete', 'deleteOne', 'deleteMany', 'replaceOne'] as const) {
  approvalSchema.pre(op, function () {
    throw new Error('ApprovalRecord is immutable');
  });
}
export const ApprovalRecord = model('ApprovalRecord', approvalSchema);

const paymentSchema = new Schema(
  {
    organizationId: oid('Organization', true),
    periodId: oid('PayrollPeriod', true),
    reference: { type: String, required: true, maxlength: 100 },
    paymentDate: { type: Date, required: true },
    amount: { type: Number, required: true },
    method: { type: String, default: 'bank_transfer' },
    recordedBy: oid('User', true),
    reconciledBy: oid('User'),
    reconciledAt: Date,
    reconciliationNote: String,
  },
  { timestamps: true },
);
paymentSchema.index({ organizationId: 1, periodId: 1 });
paymentSchema.index({ organizationId: 1, reference: 1 }, { unique: true });
export const PaymentRecord = model('PaymentRecord', paymentSchema);

const payslipSchema = new Schema(
  {
    organizationId: oid('Organization', true),
    periodId: oid('PayrollPeriod', true),
    employeeId: oid('Employee', true),
    entryId: oid('PayrollEntry', true),
    periodName: String,
    generatedAt: { type: Date, default: Date.now },
    isDemo: { type: Boolean, default: false },
  },
  { timestamps: true },
);
payslipSchema.index({ periodId: 1, employeeId: 1 }, { unique: true });
payslipSchema.index({ organizationId: 1, employeeId: 1, createdAt: -1 });
export const Payslip = model('Payslip', payslipSchema);

const correctionSchema = new Schema(
  {
    organizationId: oid('Organization', true),
    employeeId: oid('Employee', true),
    periodId: oid('PayrollPeriod'),
    subject: { type: String, required: true, maxlength: 150 },
    description: { type: String, required: true, maxlength: 2000 },
    status: { type: String, enum: ['open', 'approved', 'rejected', 'resolved'], default: 'open' },
    reviewedBy: oid('User'),
    reviewNote: String,
  },
  { timestamps: true },
);
correctionSchema.index({ organizationId: 1, employeeId: 1, createdAt: -1 });
export const CorrectionRequest = model('CorrectionRequest', correctionSchema);
