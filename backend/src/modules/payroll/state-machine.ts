export const PAYROLL_STATUSES = [
  'draft',
  'processing',
  'calculated',
  'pending_approval',
  'approved',
  'rejected',
  'payment_processing',
  'paid',
  'reconciliation_pending',
  'reconciled',
  'cancelled',
] as const;
export type PayrollStatus = (typeof PAYROLL_STATUSES)[number];

export const TRANSITIONS: Record<PayrollStatus, readonly PayrollStatus[]> = {
  draft: ['processing', 'cancelled'],
  processing: ['calculated', 'draft'],
  calculated: ['processing', 'pending_approval', 'cancelled'],
  pending_approval: ['approved', 'rejected'],
  approved: ['payment_processing'],
  rejected: ['processing', 'cancelled'],
  payment_processing: ['paid'],
  paid: ['reconciliation_pending'],
  reconciliation_pending: ['reconciled'],
  reconciled: [],
  cancelled: [],
};

export const canTransition = (from: PayrollStatus, to: PayrollStatus) => TRANSITIONS[from].includes(to);

/** Statuses in which entries may be (re)calculated. */
export const EDITABLE: readonly PayrollStatus[] = ['draft', 'calculated', 'rejected'];

/** Statuses from which payroll data is frozen. */
export const LOCKED: readonly PayrollStatus[] = ['approved', 'payment_processing', 'paid', 'reconciliation_pending', 'reconciled'];

/** Statuses after finalisation: payslips exist and employees may see their results. */
export const FINALIZED: readonly PayrollStatus[] = ['payment_processing', 'paid', 'reconciliation_pending', 'reconciled'];
