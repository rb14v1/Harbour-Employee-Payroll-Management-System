import type { Paise } from '../../../shared/money.js';

export interface SalaryComponent {
  code: string;
  name: string;
  type: 'earning' | 'employer_contribution' | 'employee_deduction' | 'variable';
  annualAmount: Paise;
  prorated: boolean;
  isBasic: boolean;
}

export interface Slab {
  fromPaise: number;
  toPaise?: number | null;
  amountPaise?: number;
  rateBps?: number;
}

export interface PolicyRules {
  id: string;
  version: number;
  isTestOnly: boolean;
  pf?: { enabled: boolean; employeeRateBps?: number; employerRateBps?: number; wageCeilingPaise?: number };
  esi?: { enabled: boolean; employeeRateBps?: number; employerRateBps?: number; grossThresholdPaise?: number };
  professionalTax?: { enabled: boolean; states: { state: string; slabs: Slab[] }[] };
  tds?: {
    enabled: boolean;
    regimes: { regime: 'old' | 'new'; standardDeductionPaise: number; slabs: Slab[]; cessBps: number }[];
  };
  gratuity?: { enabled: boolean; accrualNumerator: number; accrualDenominator: number };
}

export interface EngineEmployee {
  id: string;
  joiningDate: Date;
  exitDate?: Date | null;
  statutory: {
    taxRegime: 'old' | 'new';
    pfApplicable: boolean;
    esiApplicable: boolean;
    ptApplicable: boolean;
    ptState?: string | null;
  };
}

export interface AdditionalLine {
  code: string;
  name: string;
  amount: Paise;
  inputId?: string;
}

export interface EngineInput {
  employee: EngineEmployee;
  components: SalaryComponent[] | null;
  period: { start: Date; end: Date };
  org: { standardMonthDays: number; prorationBasis: 'calendar_days' | 'fixed_days' };
  unpaidLeaveDays: number;
  /** Approved additional earnings: overtime, variable pay, incentives. */
  additionalEarnings: AdditionalLine[];
  /** Approved other deductions. */
  otherDeductions: AdditionalLine[];
  pendingInputCount: number;
  policy: PolicyRules | null;
}

export interface Line {
  code: string;
  name: string;
  amount: Paise;
}

export interface PayrollException {
  code: string;
  severity: 'error' | 'warning';
  message: string;
}

export interface EngineResult {
  employeeId: string;
  policyVersionId: string | null;
  policyVersion: number | null;
  totalDays: number;
  payableDays: number;
  earnings: Line[];
  additionalEarnings: Line[];
  employeeDeductions: Line[];
  employerContributions: Line[];
  grossEarnings: Paise;
  totalEmployeeDeductions: Paise;
  netPay: Paise;
  totalEmployerContributions: Paise;
  employerCost: Paise;
  exceptions: PayrollException[];
  payable: boolean;
}
