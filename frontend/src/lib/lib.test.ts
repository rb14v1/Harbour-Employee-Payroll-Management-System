import { describe, expect, it } from 'vitest';
import { NAV } from '@/app/Layout';
import { money, paiseToRupeesInput, rupeesToPaise } from './format';
import { type Role } from './permissions';

describe('format', () => {
  it('formats paise as INR with Indian grouping', () => {
    expect(money(123456789)).toBe('₹12,34,567.89');
    expect(money(0)).toBe('₹0.00');
  });
  it('round-trips rupee inputs', () => {
    expect(rupeesToPaise('1234.56')).toBe(123456);
    expect(paiseToRupeesInput(123456)).toBe('1234.56');
  });
});

describe('navigation by role', () => {
  const visible = (r: Role) => NAV.filter((n) => n.show(r)).map((n) => n.label);
  it('shows employees only self-service pages', () => {
    expect(visible('employee')).toEqual(['My Pay', 'Payslips']);
  });
  it('hides payroll and audit areas from HR and managers', () => {
    expect(visible('hr_admin')).not.toContain('Audit Logs');
    expect(visible('manager')).not.toContain('Payroll Processing');
    expect(visible('manager')).toContain('Correction Requests');
  });
  it('gives finance approvers approvals and reports', () => {
    expect(visible('finance_approver')).toEqual(expect.arrayContaining(['Payroll Approvals', 'Reports']));
    expect(visible('finance_approver')).not.toContain('User Management');
  });
  it('limits audit logs and user management to system administrators', () => {
    for (const r of ['hr_admin', 'payroll_admin', 'manager', 'finance_approver', 'employee'] as Role[]) {
      expect(visible(r)).not.toContain('Audit Logs');
      expect(visible(r)).not.toContain('User Management');
    }
    expect(visible('system_admin')).toEqual(expect.arrayContaining(['Audit Logs', 'User Management']));
  });
});
