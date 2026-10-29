import argon2 from 'argon2';
import { User } from './modules/auth/user.model.js';
import { Department, Designation } from './modules/departments/department.model.js';
import { Counter, Employee } from './modules/employees/employee.model.js';
import { Organization } from './modules/organizations/organization.model.js';
import { PayrollPolicyVersion } from './modules/payroll-policies/policy.model.js';
import { SalaryRevision, SalaryStructure } from './modules/salary-structures/salary.model.js';
import { rupeesToPaise as R } from './shared/money.js';
import type { Role } from './shared/permissions.js';

/** Synthetic demo data only. Statutory values below are TEST-ONLY illustrations, not verified rules. */
export const DEMO_USERS: { email: string; name: string; role: Role }[] = [
  { email: 'admin@example.test', name: 'Asha Admin', role: 'system_admin' },
  { email: 'hr@example.test', name: 'Hari HR', role: 'hr_admin' },
  { email: 'payroll@example.test', name: 'Priya Payroll', role: 'payroll_admin' },
  { email: 'manager@example.test', name: 'Meera Manager', role: 'manager' },
  { email: 'finance@example.test', name: 'Farhan Finance', role: 'finance_approver' },
  { email: 'employee@example.test', name: 'Esha Employee', role: 'employee' },
];

const EMPLOYEES = [
  ['Meera', 'Manager', 'ENG', 'Engineering Manager', 'grade_a', null],
  ['Esha', 'Employee', 'ENG', 'Software Engineer', 'grade_b', 'Meera'],
  ['Ravi', 'Kumar', 'ENG', 'Software Engineer', 'grade_b', 'Meera'],
  ['Nikhil', 'Rao', 'ENG', 'Senior Engineer', 'grade_a', 'Meera'],
  ['Priya', 'Payroll', 'FIN', 'Payroll Specialist', 'grade_b', null],
  ['Farhan', 'Finance', 'FIN', 'Finance Lead', 'grade_a', null],
  ['Hari', 'HR', 'HR', 'HR Partner', 'grade_b', null],
  ['Asha', 'Admin', 'HR', 'Systems Administrator', 'grade_b', null],
] as const;

const ctc = (basic: number, hra: number, special: number, other: number) => [
  { code: 'BASIC', name: 'Basic salary', type: 'earning' as const, annualAmount: R(basic), prorated: true, isBasic: true },
  { code: 'HRA', name: 'House Rent Allowance', type: 'earning' as const, annualAmount: R(hra), prorated: true, isBasic: false },
  { code: 'SPECIAL', name: 'Special allowance', type: 'earning' as const, annualAmount: R(special), prorated: true, isBasic: false },
  { code: 'OTHER', name: 'Other allowances', type: 'earning' as const, annualAmount: R(other), prorated: true, isBasic: false },
];

export async function seedDemo(password: string) {
  const org = await Organization.create({
    name: 'Harbour Demo Pvt Ltd',
    logoText: 'HARBOUR',
    isDemo: true,
    locations: [{ name: 'Bengaluru', state: 'KA' }, { name: 'Pune', state: 'MH' }],
  });

  const depts = await Department.insertMany(
    [['ENG', 'Engineering'], ['FIN', 'Finance'], ['HR', 'Human Resources']].map(([code, name]) => ({ organizationId: org._id, code, name })),
  );
  const desigTitles = [...new Set(EMPLOYEES.map((e) => e[3]))];
  const desigs = await Designation.insertMany(desigTitles.map((title, i) => ({ organizationId: org._id, title, level: i })));

  const structures = await SalaryStructure.insertMany([
    { organizationId: org._id, name: 'Grade A', annualCtc: R(1000000), components: ctc(600000, 240000, 120000, 40000), effectiveFrom: new Date('2020-01-01') },
    { organizationId: org._id, name: 'Grade B', annualCtc: R(600000), components: ctc(300000, 120000, 120000, 60000), effectiveFrom: new Date('2020-01-01') },
  ]);
  const structureByKey = { grade_a: structures[0]!, grade_b: structures[1]! };

  const created: Record<string, InstanceType<typeof Employee>> = {};
  let seq = 0;
  for (const [first, last, dept, title, grade, mgr] of EMPLOYEES) {
    seq++;
    const emp = await Employee.create({
      organizationId: org._id,
      employeeCode: `EMP${String(seq).padStart(5, '0')}`,
      firstName: first,
      lastName: last,
      workEmail: `${first.toLowerCase()}.${last.toLowerCase()}@example.test`,
      departmentId: depts.find((d) => d.code === dept)!._id,
      designationId: desigs.find((d) => d.title === title)!._id,
      managerId: mgr ? created[mgr]?._id : undefined,
      joiningDate: new Date('2024-01-15'),
      workLocation: 'Bengaluru',
      statutory: { taxRegime: 'new', pfApplicable: true, ptApplicable: true, ptState: 'KA' },
    });
    created[first] = emp;
    const st = structureByKey[grade];
    await SalaryRevision.create({
      organizationId: org._id,
      employeeId: emp._id,
      structureId: st._id,
      components: st.components,
      annualCtc: st.annualCtc,
      effectiveFrom: new Date('2024-01-15'),
      reason: 'Initial salary assignment',
      createdBy: emp._id, // replaced below once users exist
    });
  }
  await Counter.updateOne({ _id: `employee:${org.id}` }, { seq }, { upsert: true });

  const hash = await argon2.hash(password);
  const users = [];
  for (const u of DEMO_USERS) {
    const linked = created[u.name.split(' ')[0]!];
    users.push(await User.create({ organizationId: org._id, email: u.email, name: u.name, role: u.role, passwordHash: hash, employeeId: linked?._id }));
  }
  const admin = users[0]!;
  await SalaryRevision.updateMany({ organizationId: org._id }, { createdBy: admin._id });

  await PayrollPolicyVersion.create({
    organizationId: org._id,
    name: 'TEST-ONLY illustrative policy',
    version: 1,
    effectiveFrom: new Date('2020-01-01'),
    isTestOnly: true,
    createdBy: admin._id,
    pf: { enabled: true, employeeRateBps: 1200, employerRateBps: 1200, wageCeilingPaise: R(15000) },
    esi: { enabled: false },
    professionalTax: { enabled: true, states: [{ state: 'KA', slabs: [{ fromPaise: 0, toPaise: R(24999.99), amountPaise: 0 }, { fromPaise: R(25000), amountPaise: R(200) }] }] },
    tds: {
      enabled: true,
      regimes: [{ regime: 'new', standardDeductionPaise: R(50000), cessBps: 400, slabs: [{ fromPaise: 0, toPaise: R(300000), rateBps: 0 }, { fromPaise: R(300000), toPaise: R(700000), rateBps: 500 }, { fromPaise: R(700000), rateBps: 1000 }] }],
    },
    gratuity: { enabled: false, accrualNumerator: 0, accrualDenominator: 1 },
  });

  return { org, users, employees: created, departments: depts, designations: desigs, structures };
}
