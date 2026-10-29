export interface Line { code: string; name: string; amount: number }
export interface PayrollException { code: string; severity: 'error' | 'warning'; message: string }
export interface Totals { employeeCount: number; payableCount: number; exceptionCount: number; gross: number; deductions: number; net: number; employerContributions: number; employerCost: number }
export interface Period {
  _id: string; name: string; year: number; month: number; startDate: string; endDate: string; cutoffDate: string;
  status: string; paymentStatus: string; reconciliationStatus: string; totals: Totals; calculationRun: number; approvedAt?: string;
}
export interface Entry {
  _id: string; employeeId: string; snapshot: { employeeCode: string; name: string; departmentName: string; designation: string };
  payableDays: number; totalDays: number; earnings: Line[]; additionalEarnings: Line[]; employeeDeductions: Line[]; employerContributions: Line[];
  grossEarnings: number; totalEmployeeDeductions: number; netPay: number; totalEmployerContributions: number; employerCost: number;
  exceptions: PayrollException[]; payable: boolean; policyVersion?: number;
}
export interface Ref { _id: string; name?: string; code?: string; title?: string }
export interface Employee {
  _id: string; employeeCode: string; firstName: string; lastName: string; workEmail: string; status: string; employmentType: string;
  workLocation: string; joiningDate: string; exitDate?: string; departmentId: Ref; designationId: Ref;
  managerId?: { _id: string; firstName: string; lastName: string; employeeCode: string };
  statutory: { taxRegime: 'old' | 'new'; pfApplicable: boolean; esiApplicable: boolean; ptApplicable: boolean; ptState?: string };
  bank?: { accountHolder?: string; accountNumberMasked?: string; ifsc?: string }; panMasked?: string;
}
export interface Component { code: string; name: string; type: 'earning' | 'employer_contribution' | 'employee_deduction' | 'variable'; annualAmount: number; prorated: boolean; isBasic: boolean }
export interface SalaryStructure { _id: string; name: string; annualCtc: number; components: Component[]; effectiveFrom: string; isActive: boolean; version: number }
export interface Payslip {
  _id: string; employeeId: string; periodId: string; periodName: string; isDemo: boolean;
  entryId?: { snapshot: { name: string; employeeCode: string }; grossEarnings: number; netPay: number; totalEmployeeDeductions: number };
}
