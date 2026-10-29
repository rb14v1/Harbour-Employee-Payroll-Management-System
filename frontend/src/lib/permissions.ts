export type Role = 'system_admin' | 'hr_admin' | 'payroll_admin' | 'manager' | 'finance_approver' | 'employee';

export const ROLE_LABELS: Record<Role, string> = {
  system_admin: 'System Administrator',
  hr_admin: 'HR Administrator',
  payroll_admin: 'Payroll Administrator',
  manager: 'Manager',
  finance_approver: 'Finance Approver',
  employee: 'Employee',
};

/** UI hints only. The backend enforces every permission independently. */
export const can = {
  manageEmployees: (r: Role) => r === 'hr_admin',
  viewSalary: (r: Role) => r === 'hr_admin' || r === 'payroll_admin',
  manageSalary: (r: Role) => r === 'hr_admin',
  manageInputs: (r: Role) => r === 'hr_admin' || r === 'payroll_admin',
  viewPayroll: (r: Role) => ['system_admin', 'hr_admin', 'payroll_admin', 'finance_approver'].includes(r),
  preparePayroll: (r: Role) => r === 'payroll_admin',
  approvePayroll: (r: Role) => r === 'finance_approver',
  finalizePayroll: (r: Role) => r === 'payroll_admin',
  recordPayment: (r: Role) => r === 'finance_approver',
  viewReports: (r: Role) => r === 'payroll_admin' || r === 'finance_approver',
  viewAudit: (r: Role) => r === 'system_admin',
  manageOrg: (r: Role) => r === 'system_admin',
  managePolicy: (r: Role) => r === 'payroll_admin' || r === 'system_admin',
  manageUsers: (r: Role) => r === 'system_admin',
  manageDepartments: (r: Role) => r === 'hr_admin' || r === 'system_admin',
  reviewRequests: (r: Role) => r === 'manager' || r === 'payroll_admin',
  seeAllPayslips: (r: Role) => r === 'payroll_admin' || r === 'finance_approver',
};
