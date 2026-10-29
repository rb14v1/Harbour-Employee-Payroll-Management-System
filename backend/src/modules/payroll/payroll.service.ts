import { Types } from 'mongoose';
import { Department, Designation } from '../departments/department.model.js';
import { Employee } from '../employees/employee.model.js';
import { Organization } from '../organizations/organization.model.js';
import { PayrollPolicyVersion } from '../payroll-policies/policy.model.js';
import { SalaryRevision } from '../salary-structures/salary.model.js';
import { calculatePayroll, selectPolicy } from './engine/engine.js';
import type { EngineResult, PolicyRules, SalaryComponent } from './engine/types.js';
import { PayrollAdjustment, PayrollInput } from './payroll.model.js';

type PeriodLike = { _id: Types.ObjectId; organizationId: Types.ObjectId; startDate: Date; endDate: Date };

export interface CalculatedEmployee {
  result: EngineResult;
  snapshot: {
    employeeCode: string;
    name: string;
    departmentId: Types.ObjectId;
    departmentName: string;
    designation: string;
    workLocation: string;
  };
  salaryRevisionId: Types.ObjectId | null;
  inputIds: Types.ObjectId[];
}

export async function loadPolicy(organizationId: Types.ObjectId, on: Date): Promise<PolicyRules | null> {
  const all = await PayrollPolicyVersion.find({ organizationId, effectiveFrom: { $lte: on } }).sort({ effectiveFrom: -1 }).lean();
  const p = selectPolicy(all, on);
  if (!p) return null;
  return {
    id: p._id.toString(),
    version: p.version,
    isTestOnly: p.isTestOnly,
    pf: p.pf as PolicyRules['pf'],
    esi: p.esi as PolicyRules['esi'],
    professionalTax: p.professionalTax as PolicyRules['professionalTax'],
    tds: p.tds as PolicyRules['tds'],
    gratuity: p.gratuity as PolicyRules['gratuity'],
  };
}

/** Runs the pure engine for every eligible employee. No writes. */
export async function computePeriod(period: PeriodLike): Promise<{ rows: CalculatedEmployee[]; policy: PolicyRules | null }> {
  const org = await Organization.findById(period.organizationId).lean();
  if (!org) throw new Error('Organization missing');
  const policy = await loadPolicy(period.organizationId, period.endDate);

  const employees = await Employee.find({
    organizationId: period.organizationId,
    joiningDate: { $lte: period.endDate },
    $or: [{ exitDate: null }, { exitDate: { $exists: false } }, { exitDate: { $gte: period.startDate } }],
  }).lean();
  const ids = employees.map((e) => e._id);

  const [revisions, inputs, adjustments, depts, desigs] = await Promise.all([
    SalaryRevision.find({
      organizationId: period.organizationId,
      employeeId: { $in: ids },
      effectiveFrom: { $lte: period.endDate },
      $or: [{ effectiveTo: null }, { effectiveTo: { $exists: false } }, { effectiveTo: { $gte: period.startDate } }],
    })
      .sort({ effectiveFrom: -1 })
      .lean(),
    PayrollInput.find({ organizationId: period.organizationId, periodId: period._id }).lean(),
    PayrollAdjustment.find({ organizationId: period.organizationId, targetPeriodId: period._id, status: { $in: ['approved', 'applied'] } }).lean(),
    Department.find({ organizationId: period.organizationId }).lean(),
    Designation.find({ organizationId: period.organizationId }).lean(),
  ]);

  const revByEmp = new Map<string, (typeof revisions)[number]>();
  for (const r of revisions) if (!revByEmp.has(r.employeeId.toString())) revByEmp.set(r.employeeId.toString(), r);

  const rows: CalculatedEmployee[] = employees.map((e) => {
    const key = e._id.toString();
    const rev = revByEmp.get(key);
    const myInputs = inputs.filter((i) => i.employeeId.toString() === key);
    const approved = myInputs.filter((i) => i.status === 'approved');
    const myAdj = adjustments.filter((a) => a.employeeId.toString() === key);

    const additionalEarnings = [
      ...approved
        .filter((i) => ['overtime', 'variable_pay', 'incentive', 'adjustment'].includes(i.type))
        .map((i) => ({ code: i.type.toUpperCase(), name: i.description || i.type.replace('_', ' '), amount: i.value, inputId: i._id.toString() })),
      ...myAdj.filter((a) => a.amount > 0).map((a) => ({ code: 'ADJUSTMENT', name: `Prior-period adjustment: ${a.reason}`.slice(0, 100), amount: a.amount })),
    ];
    const otherDeductions = [
      ...approved.filter((i) => i.type === 'deduction').map((i) => ({ code: 'DEDUCTION', name: i.description || 'Deduction', amount: i.value, inputId: i._id.toString() })),
      ...myAdj.filter((a) => a.amount < 0).map((a) => ({ code: 'ADJUSTMENT', name: `Prior-period recovery: ${a.reason}`.slice(0, 100), amount: -a.amount })),
    ];

    const result = calculatePayroll({
      employee: {
        id: key,
        joiningDate: e.joiningDate,
        exitDate: e.exitDate,
        statutory: {
          taxRegime: e.statutory?.taxRegime ?? 'new',
          pfApplicable: Boolean(e.statutory?.pfApplicable),
          esiApplicable: Boolean(e.statutory?.esiApplicable),
          ptApplicable: Boolean(e.statutory?.ptApplicable),
          ptState: e.statutory?.ptState,
        },
      },
      components: rev ? (rev.components as SalaryComponent[]) : null,
      period: { start: period.startDate, end: period.endDate },
      org: { standardMonthDays: org.settings?.standardMonthDays ?? 30, prorationBasis: org.settings?.prorationBasis ?? 'calendar_days' },
      unpaidLeaveDays: approved.filter((i) => i.type === 'unpaid_leave').reduce((a, i) => a + i.value, 0),
      additionalEarnings,
      otherDeductions,
      pendingInputCount: myInputs.filter((i) => i.status === 'pending').length,
      policy,
    });

    const dept = depts.find((d) => d._id.equals(e.departmentId));
    const desig = desigs.find((d) => d._id.equals(e.designationId));
    return {
      result,
      snapshot: {
        employeeCode: e.employeeCode,
        name: `${e.firstName} ${e.lastName}`,
        departmentId: e.departmentId,
        departmentName: dept?.name ?? '',
        designation: desig?.title ?? '',
        workLocation: e.workLocation,
      },
      salaryRevisionId: rev?._id ?? null,
      inputIds: approved.map((i) => i._id),
    };
  });

  return { rows, policy };
}

export function totalsOf(rows: CalculatedEmployee[]) {
  const payable = rows.filter((r) => r.result.payable);
  const add = (f: (r: EngineResult) => number) => payable.reduce((a, r) => a + f(r.result), 0);
  return {
    employeeCount: rows.length,
    payableCount: payable.length,
    exceptionCount: rows.filter((r) => r.result.exceptions.length > 0).length,
    gross: add((r) => r.grossEarnings),
    deductions: add((r) => r.totalEmployeeDeductions),
    net: add((r) => r.netPay),
    employerContributions: add((r) => r.totalEmployerContributions),
    employerCost: add((r) => r.employerCost),
  };
}
