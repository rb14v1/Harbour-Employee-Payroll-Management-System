import { mulDiv, percentOf, sum, type Paise } from '../../../shared/money.js';
import type { EngineInput, EngineResult, Line, PayrollException, PolicyRules, Slab } from './types.js';

const DAY_MS = 86_400_000;
const startOfUtcDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
const daysInclusive = (from: number, to: number) => (to < from ? 0 : Math.round((to - from) / DAY_MS) + 1);

export function slabTax(taxable: Paise, slabs: Slab[]): Paise {
  let tax = 0;
  for (const s of slabs) {
    const upper = s.toPaise ?? Number.POSITIVE_INFINITY;
    if (taxable <= s.fromPaise) continue;
    const portion = Math.min(taxable, upper) - s.fromPaise;
    tax += percentOf(portion, s.rateBps ?? 0);
  }
  return tax;
}

export function selectPolicy<T extends { effectiveFrom: Date }>(policies: T[], on: Date): T | null {
  const eligible = policies.filter((p) => p.effectiveFrom.getTime() <= on.getTime());
  eligible.sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime());
  return eligible[0] ?? null;
}

export function calculatePayroll(input: EngineInput): EngineResult {
  const { employee, components, period, org, policy } = input;
  const exceptions: PayrollException[] = [];
  const err = (code: string, message: string) => exceptions.push({ code, severity: 'error', message });
  const warn = (code: string, message: string) => exceptions.push({ code, severity: 'warning', message });

  const pStart = startOfUtcDay(period.start);
  const pEnd = startOfUtcDay(period.end);
  const calendarDays = daysInclusive(pStart, pEnd);
  const totalDays = org.prorationBasis === 'fixed_days' ? org.standardMonthDays : calendarDays;

  const empStart = Math.max(pStart, startOfUtcDay(employee.joiningDate));
  const empEnd = employee.exitDate ? Math.min(pEnd, startOfUtcDay(employee.exitDate)) : pEnd;
  const employedDays = Math.min(daysInclusive(empStart, empEnd), totalDays);

  if (employedDays === 0) err('NOT_EMPLOYED', 'Employee not employed during this payroll period');
  if (!Number.isFinite(input.unpaidLeaveDays) || input.unpaidLeaveDays < 0) {
    err('INVALID_UNPAID_LEAVE', 'Unpaid leave days must be a non-negative number');
  }
  if (Number.isFinite(input.unpaidLeaveDays) && (input.unpaidLeaveDays * 2) % 1 !== 0) {
    err('INVALID_UNPAID_LEAVE', 'Unpaid leave must be in whole or half days');
  }
  if (input.unpaidLeaveDays > employedDays) {
    err('UNPAID_LEAVE_EXCEEDS_DAYS', `Unpaid leave (${input.unpaidLeaveDays}) exceeds employed days (${employedDays})`);
  }
  const payableDays = Math.max(0, employedDays - Math.max(0, input.unpaidLeaveDays || 0));

  if (!components || components.length === 0) err('NO_SALARY_STRUCTURE', 'No effective salary revision for this period');
  if (!policy) warn('NO_POLICY', 'No payroll policy version effective for this period; statutory items skipped');
  if (input.pendingInputCount > 0) warn('PENDING_INPUTS', `${input.pendingInputCount} payroll input(s) awaiting approval were excluded`);

  const comps = components ?? [];
  const prorate = (c: { annualAmount: Paise; prorated: boolean }): Paise => {
    const monthly = mulDiv(c.annualAmount, 1, 12);
    // Half-day granularity: scale both sides by 2 so the ratio stays integral.
    return c.prorated ? mulDiv(monthly, Math.round(payableDays * 2), totalDays * 2) : monthly;
  };

  const earnings: Line[] = comps
    .filter((c) => c.type === 'earning')
    .map((c) => ({ code: c.code, name: c.name, amount: prorate(c) }));
  const additionalEarnings: Line[] = input.additionalEarnings.map((a) => ({ code: a.code, name: a.name, amount: a.amount }));
  if (additionalEarnings.some((a) => !Number.isSafeInteger(a.amount) || a.amount < 0)) {
    err('INVALID_ADDITIONAL_EARNING', 'Additional earnings must be non-negative integer paise');
  }

  const grossEarnings = sum(earnings.map((l) => l.amount)) + sum(additionalEarnings.map((l) => l.amount));
  const basicProrated = sum(comps.filter((c) => c.type === 'earning' && c.isBasic).map(prorate));

  const employeeDeductions: Line[] = comps
    .filter((c) => c.type === 'employee_deduction')
    .map((c) => ({ code: c.code, name: c.name, amount: prorate(c) }));
  const employerContributions: Line[] = comps
    .filter((c) => c.type === 'employer_contribution')
    .map((c) => ({ code: c.code, name: c.name, amount: prorate(c) }));

  if (policy && grossEarnings > 0) applyStatutory(policy, input, { grossEarnings, basicProrated, comps, payableDays }, employeeDeductions, employerContributions, err, warn);

  for (const d of input.otherDeductions) {
    if (!Number.isSafeInteger(d.amount) || d.amount < 0) err('INVALID_DEDUCTION', `Invalid deduction ${d.code}`);
    else employeeDeductions.push({ code: d.code, name: d.name, amount: d.amount });
  }

  const totalEmployeeDeductions = sum(employeeDeductions.map((l) => l.amount));
  const netPay = grossEarnings - totalEmployeeDeductions;
  if (netPay < 0) err('NEGATIVE_NET_PAY', 'Deductions exceed gross earnings');
  const totalEmployerContributions = sum(employerContributions.map((l) => l.amount));

  return {
    employeeId: employee.id,
    policyVersionId: policy?.id ?? null,
    policyVersion: policy?.version ?? null,
    totalDays,
    payableDays,
    earnings,
    additionalEarnings,
    employeeDeductions,
    employerContributions,
    grossEarnings,
    totalEmployeeDeductions,
    netPay,
    totalEmployerContributions,
    employerCost: grossEarnings + totalEmployerContributions,
    exceptions,
    payable: !exceptions.some((e) => e.severity === 'error'),
  };
}

interface Ctx {
  grossEarnings: Paise;
  basicProrated: Paise;
  comps: { type: string; annualAmount: Paise }[];
  payableDays: number;
}

function applyStatutory(
  policy: PolicyRules,
  input: EngineInput,
  ctx: Ctx,
  deductions: Line[],
  employer: Line[],
  err: (c: string, m: string) => void,
  warn: (c: string, m: string) => void,
): void {
  const st = input.employee.statutory;

  if (policy.pf?.enabled && st.pfApplicable) {
    const { employeeRateBps: e, employerRateBps: r, wageCeilingPaise: ceil } = policy.pf;
    if (e == null || r == null) err('PF_CONFIG_MISSING', 'PF enabled but rates are not configured');
    else {
      const wage = ceil != null ? Math.min(ctx.basicProrated, ceil) : ctx.basicProrated;
      deductions.push({ code: 'PF_EE', name: 'Provident Fund (Employee)', amount: percentOf(wage, e) });
      employer.push({ code: 'PF_ER', name: 'Provident Fund (Employer)', amount: percentOf(wage, r) });
    }
  }

  if (policy.esi?.enabled && st.esiApplicable) {
    const { employeeRateBps: e, employerRateBps: r, grossThresholdPaise: t } = policy.esi;
    if (e == null || r == null || t == null) err('ESI_CONFIG_MISSING', 'ESI enabled but rates/threshold are not configured');
    else if (ctx.grossEarnings <= t) {
      deductions.push({ code: 'ESI_EE', name: 'ESI (Employee)', amount: percentOf(ctx.grossEarnings, e) });
      employer.push({ code: 'ESI_ER', name: 'ESI (Employer)', amount: percentOf(ctx.grossEarnings, r) });
    } else warn('ESI_ABOVE_THRESHOLD', 'ESI flagged applicable but gross exceeds threshold; not deducted');
  }

  if (policy.professionalTax?.enabled && st.ptApplicable) {
    const stateRules = policy.professionalTax.states.find((s) => s.state === st.ptState);
    if (!st.ptState || !stateRules) err('PT_STATE_MISSING', `No professional tax rules for state "${st.ptState ?? ''}"`);
    else {
      const slab = stateRules.slabs.find((s) => ctx.grossEarnings >= s.fromPaise && (s.toPaise == null || ctx.grossEarnings <= s.toPaise));
      deductions.push({ code: 'PT', name: 'Professional Tax', amount: slab?.amountPaise ?? 0 });
    }
  }

  if (policy.tds?.enabled) {
    const regime = policy.tds.regimes.find((r) => r.regime === st.taxRegime);
    if (!regime) err('TDS_REGIME_MISSING', `No TDS rules configured for ${st.taxRegime} regime`);
    else if (ctx.payableDays > 0) {
      const annualGross = sum(ctx.comps.filter((c) => c.type === 'earning').map((c) => c.annualAmount));
      const taxable = Math.max(0, annualGross - regime.standardDeductionPaise);
      const base = slabTax(taxable, regime.slabs);
      const annualTax = base + percentOf(base, regime.cessBps);
      deductions.push({ code: 'TDS', name: 'Tax Deducted at Source', amount: mulDiv(annualTax, 1, 12) });
    }
  }

  if (policy.gratuity?.enabled && policy.gratuity.accrualDenominator > 0) {
    employer.push({
      code: 'GRATUITY',
      name: 'Gratuity accrual',
      amount: mulDiv(ctx.basicProrated, policy.gratuity.accrualNumerator, policy.gratuity.accrualDenominator),
    });
  }
}

/** Salary structure validation: components must reconcile to annual CTC. */
export function validateStructure(components: { type: string; annualAmount: Paise }[], annualCtc: Paise): string[] {
  const problems: string[] = [];
  const ctcParts = components.filter((c) => c.type !== 'employee_deduction');
  const total = sum(ctcParts.map((c) => c.annualAmount));
  if (total !== annualCtc) problems.push(`Earnings + employer contributions + variable (${total}) must equal annual CTC (${annualCtc})`);
  const basics = components.filter((c) => (c as { isBasic?: boolean }).isBasic);
  if (basics.length > 1) problems.push('Only one component may be marked as basic');
  return problems;
}
