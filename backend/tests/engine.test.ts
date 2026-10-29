import { describe, expect, it } from 'vitest';
import { calculatePayroll, selectPolicy, slabTax, validateStructure } from '../src/modules/payroll/engine/engine.js';
import type { EngineInput, PolicyRules, SalaryComponent } from '../src/modules/payroll/engine/types.js';
import { mulDiv, paiseToRupees, rupeesToPaise } from '../src/shared/money.js';
import { canTransition } from '../src/modules/payroll/state-machine.js';

const R = rupeesToPaise;
const comps: SalaryComponent[] = [
  { code: 'BASIC', name: 'Basic', type: 'earning', annualAmount: R(600000), prorated: true, isBasic: true },
  { code: 'HRA', name: 'HRA', type: 'earning', annualAmount: R(240000), prorated: true, isBasic: false },
  { code: 'SPECIAL', name: 'Special', type: 'earning', annualAmount: R(120000), prorated: true, isBasic: false },
  { code: 'OTHER', name: 'Other', type: 'earning', annualAmount: R(40000), prorated: true, isBasic: false },
];

// TEST-ONLY illustrative rules. Not statutory values.
const policy: PolicyRules = {
  id: 'p1',
  version: 1,
  isTestOnly: true,
  pf: { enabled: true, employeeRateBps: 1200, employerRateBps: 1200, wageCeilingPaise: R(15000) },
  esi: { enabled: true, employeeRateBps: 75, employerRateBps: 325, grossThresholdPaise: R(21000) },
  professionalTax: { enabled: true, states: [{ state: 'KA', slabs: [{ fromPaise: 0, toPaise: R(24999), amountPaise: 0 }, { fromPaise: R(25000), amountPaise: R(200) }] }] },
  tds: {
    enabled: true,
    regimes: [{ regime: 'new', standardDeductionPaise: R(50000), cessBps: 400, slabs: [{ fromPaise: 0, toPaise: R(300000), rateBps: 0 }, { fromPaise: R(300000), toPaise: R(700000), rateBps: 500 }, { fromPaise: R(700000), rateBps: 1000 }] }],
  },
};

const base = (over: Partial<EngineInput> = {}): EngineInput => ({
  employee: { id: 'e1', joiningDate: new Date('2020-01-01'), statutory: { taxRegime: 'new', pfApplicable: true, esiApplicable: false, ptApplicable: true, ptState: 'KA' } },
  components: comps,
  period: { start: new Date('2026-04-01'), end: new Date('2026-04-30') },
  org: { standardMonthDays: 30, prorationBasis: 'calendar_days' },
  unpaidLeaveDays: 0,
  additionalEarnings: [],
  otherDeductions: [],
  pendingInputCount: 0,
  policy,
  ...over,
});

describe('money', () => {
  it('parses and formats exactly', () => {
    expect(R('1234.5')).toBe(123450);
    expect(paiseToRupees(-5)).toBe('-0.05');
    expect(() => R('1.234')).toThrow();
  });
  it('rounds half away from zero', () => {
    expect(mulDiv(1, 1, 2)).toBe(1);
    expect(mulDiv(-1, 1, 2)).toBe(-1);
    expect(mulDiv(100, 1, 3)).toBe(33);
    expect(mulDiv(200, 1, 3)).toBe(67);
  });
});

describe('structure validation', () => {
  it('reconciles components to CTC', () => {
    expect(validateStructure(comps, R(1000000))).toEqual([]);
    expect(validateStructure(comps, R(999999))).toHaveLength(1);
  });
});

describe('payroll engine', () => {
  it('computes full month gross, deductions and net', () => {
    const r = calculatePayroll(base());
    expect(r.payable).toBe(true);
    expect(r.grossEarnings).toBe(8333333); // 50000 + 20000 + 10000 + 3333.33
    const pf = r.employeeDeductions.find((d) => d.code === 'PF_EE')!;
    expect(pf.amount).toBe(R(1800)); // 12% of ceiling 15000
    expect(r.netPay).toBe(r.grossEarnings - r.totalEmployeeDeductions);
    expect(r.employerCost).toBe(r.grossEarnings + r.totalEmployerContributions);
  });

  it('is deterministic', () => {
    expect(calculatePayroll(base())).toEqual(calculatePayroll(base()));
  });

  it('prorates for unpaid leave', () => {
    const full = calculatePayroll(base({ policy: null }));
    const part = calculatePayroll(base({ policy: null, unpaidLeaveDays: 3 }));
    expect(part.payableDays).toBe(27);
    expect(part.grossEarnings).toBeLessThan(full.grossEarnings);
    const basic = part.earnings.find((e) => e.code === 'BASIC')!;
    expect(basic.amount).toBe(mulDiv(mulDiv(R(600000), 1, 12), 27, 30));
  });

  it('prorates for mid-month joiner', () => {
    const r = calculatePayroll(base({ policy: null, employee: { ...base().employee, joiningDate: new Date('2026-04-16') } }));
    expect(r.payableDays).toBe(15);
  });

  it('flags error when not employed', () => {
    const r = calculatePayroll(base({ employee: { ...base().employee, joiningDate: new Date('2026-06-01') } }));
    expect(r.payable).toBe(false);
    expect(r.exceptions.map((e) => e.code)).toContain('NOT_EMPLOYED');
  });

  it('flags missing salary structure instead of guessing', () => {
    const r = calculatePayroll(base({ components: null }));
    expect(r.payable).toBe(false);
    expect(r.grossEarnings).toBe(0);
  });

  it('flags unpaid leave beyond employed days', () => {
    const r = calculatePayroll(base({ unpaidLeaveDays: 40 }));
    expect(r.exceptions.map((e) => e.code)).toContain('UNPAID_LEAVE_EXCEEDS_DAYS');
  });

  it('adds approved additional earnings and other deductions', () => {
    const a = calculatePayroll(base({ policy: null }));
    const b = calculatePayroll(base({ policy: null, additionalEarnings: [{ code: 'BONUS', name: 'Bonus', amount: R(5000) }], otherDeductions: [{ code: 'ADV', name: 'Advance', amount: R(1000) }] }));
    expect(b.grossEarnings - a.grossEarnings).toBe(R(5000));
    expect(b.netPay - a.netPay).toBe(R(4000));
  });

  it('flags negative net pay', () => {
    const r = calculatePayroll(base({ policy: null, otherDeductions: [{ code: 'ADV', name: 'Advance', amount: R(999999) }] }));
    expect(r.exceptions.map((e) => e.code)).toContain('NEGATIVE_NET_PAY');
  });

  it('skips statutory items for non-applicable employees', () => {
    const r = calculatePayroll(base({ employee: { ...base().employee, statutory: { taxRegime: 'new', pfApplicable: false, esiApplicable: false, ptApplicable: false } } }));
    expect(r.employeeDeductions.map((d) => d.code)).toEqual(['TDS']);
  });

  it('errors when PT state rules are missing', () => {
    const r = calculatePayroll(base({ employee: { ...base().employee, statutory: { ...base().employee.statutory, ptState: 'XX' } } }));
    expect(r.exceptions.map((e) => e.code)).toContain('PT_STATE_MISSING');
  });

  it('warns about pending inputs', () => {
    const r = calculatePayroll(base({ pendingInputCount: 2 }));
    expect(r.exceptions.find((e) => e.code === 'PENDING_INPUTS')?.severity).toBe('warning');
  });
});

describe('tax slabs and policy selection', () => {
  it('computes marginal slab tax', () => {
    expect(slabTax(R(800000), policy.tds!.regimes[0]!.slabs)).toBe(R(20000) + R(10000));
  });
  it('selects the policy effective on the date', () => {
    const ps = [{ effectiveFrom: new Date('2025-04-01'), v: 1 }, { effectiveFrom: new Date('2026-04-01'), v: 2 }];
    expect(selectPolicy(ps, new Date('2026-03-31'))?.v).toBe(1);
    expect(selectPolicy(ps, new Date('2026-04-01'))?.v).toBe(2);
    expect(selectPolicy(ps, new Date('2024-01-01'))).toBeNull();
  });
});

describe('state machine', () => {
  it('allows only legal transitions', () => {
    expect(canTransition('draft', 'processing')).toBe(true);
    expect(canTransition('calculated', 'pending_approval')).toBe(true);
    expect(canTransition('approved', 'draft')).toBe(false);
    expect(canTransition('paid', 'calculated')).toBe(false);
    expect(canTransition('reconciled', 'cancelled')).toBe(false);
  });
});
