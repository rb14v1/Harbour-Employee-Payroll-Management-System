export const ROLES = ['system_admin', 'hr_admin', 'payroll_admin', 'manager', 'finance_approver', 'employee'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'org:manage',
  'user:manage',
  'policy:manage',
  'audit:view',
  'employee:read',
  'employee:write',
  'employee:sensitive',
  'department:manage',
  'salary:manage',
  'salary:read',
  'input:read',
  'input:manage',
  'payroll:read',
  'payroll:prepare',
  'payroll:approve',
  'payroll:finalize',
  'payment:record',
  'payslip:read_any',
  'report:view',
  'request:review',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  system_admin: ['org:manage', 'user:manage', 'policy:manage', 'audit:view', 'department:manage', 'employee:read', 'payroll:read'],
  hr_admin: ['employee:read', 'employee:write', 'employee:sensitive', 'department:manage', 'salary:manage', 'salary:read', 'input:read', 'input:manage', 'payroll:read'],
  payroll_admin: ['employee:read', 'salary:read', 'input:read', 'input:manage', 'payroll:read', 'payroll:prepare', 'payroll:finalize', 'payslip:read_any', 'report:view', 'policy:manage', 'request:review'],
  manager: ['employee:read', 'request:review'],
  finance_approver: ['payroll:read', 'payroll:approve', 'payment:record', 'report:view', 'payslip:read_any'],
  employee: [],
};

export const hasPermission = (role: Role, p: Permission): boolean => ROLE_PERMISSIONS[role].includes(p);
