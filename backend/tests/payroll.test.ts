import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditLog } from '../src/modules/audit/audit.model.js';
import { ApprovalRecord, PayrollEntry } from '../src/modules/payroll/payroll.model.js';
import { User } from '../src/modules/auth/user.model.js';
import { seedDemo } from '../src/seed-data.js';
import { app as makeApp, type Client, loginAs, PASSWORD, resetAndSeed, startDb, stopDb } from './helpers.js';

const app = makeApp();
let hr: Client, payroll: Client, finance: Client, emp: Client, mgr: Client, admin: Client;
let seeded: Awaited<ReturnType<typeof resetAndSeed>>;
let periodId: string;

async function clients() {
  const login = (r: string) => loginAs(app, `${r}@example.test`);
  hr = await login('hr');
  payroll = await login('payroll');
  finance = await login('finance');
  emp = await login('employee');
  mgr = await login('manager');
  admin = await login('admin');
}

async function newPeriod(year = 2026, month = 4) {
  const r = await payroll.post('/payroll/periods', { year, month });
  expect(r.status).toBe(201);
  return r.body.data._id as string;
}

async function toPendingApproval(id: string) {
  expect((await payroll.post(`/payroll/${id}/calculate`)).status).toBe(200);
  expect((await payroll.post(`/payroll/${id}/submit`)).status).toBe(200);
}

beforeAll(startDb);
afterAll(stopDb);
beforeEach(async () => {
  seeded = await resetAndSeed();
  await clients();
  periodId = await newPeriod();
});

describe('payroll inputs', () => {
  it('keeps unapproved inputs out of calculations and enforces separation of entry and approval', async () => {
    const esha = seeded.employees.Esha!;
    const add = await hr.post(`/payroll/${periodId}/inputs`, { employeeId: esha.id, type: 'incentive', value: 500000, description: 'Q1 incentive' });
    expect(add.status).toBe(201);
    expect(add.body.data.status).toBe('pending');

    const before = await payroll.post(`/payroll/${periodId}/simulate`);
    const eshaRow = (r: { body: { data: { entries: { employeeCode: string; grossEarnings: number; exceptions: { code: string }[] }[] } } }) => r.body.data.entries.find((e) => e.employeeCode === esha.employeeCode)!;
    expect(eshaRow(before).exceptions.map((e) => e.code)).toContain('PENDING_INPUTS');

    expect((await hr.post(`/payroll/inputs/${add.body.data._id}/review`, { decision: 'approved' })).status).toBe(403); // own entry
    expect((await payroll.post(`/payroll/inputs/${add.body.data._id}/review`, { decision: 'approved' })).status).toBe(200);

    const after = await payroll.post(`/payroll/${periodId}/simulate`);
    expect(eshaRow(after).grossEarnings - eshaRow(before).grossEarnings).toBe(500000);
  });

  it('rejects an invalid CSV import atomically and accepts a valid one', async () => {
    const bad = await request(app).post(`/api/v1/payroll/${periodId}/inputs/import`);
    expect(bad.status).toBe(401);
    const agent = request.agent(app);
    const login = await agent.post('/api/v1/auth/login').send({ email: 'hr@example.test', password: PASSWORD });
    const csrf = login.body.data.csrfToken;
    const invalid = 'employeeCode,type,value,description\nEMP00002,incentive,1000.50,ok\nEMP99999,incentive,5,bad code\nEMP00002,unpaid_leave,0.3,bad days\n';
    const r = await agent.post(`/api/v1/payroll/${periodId}/inputs/import`).set('X-CSRF-Token', csrf).attach('file', Buffer.from(invalid), 'inputs.csv');
    expect(r.status).toBe(422);
    expect(r.body.error.details).toHaveLength(2);
    expect((await hr.get(`/payroll/${periodId}/inputs`)).body.meta.total).toBe(0);

    const valid = 'employeeCode,type,value,description\nEMP00002,incentive,1000.50,ok\nEMP00003,unpaid_leave,2,leave\n';
    const ok = await agent.post(`/api/v1/payroll/${periodId}/inputs/import`).set('X-CSRF-Token', csrf).attach('file', Buffer.from(valid), 'inputs.csv');
    expect(ok.status).toBe(201);
    const list = await hr.get(`/payroll/${periodId}/inputs`);
    expect(list.body.data.find((i: { type: string }) => i.type === 'incentive').value).toBe(100050);
    expect(list.body.data.every((i: { source: string; status: string }) => i.source === 'csv_import' && i.status === 'pending')).toBe(true);

    const notCsv = await agent.post(`/api/v1/payroll/${periodId}/inputs/import`).set('X-CSRF-Token', csrf).attach('file', Buffer.from('x'), 'evil.exe');
    expect(notCsv.status).toBe(400);
  });
});

describe('calculation', () => {
  it('simulation stores nothing; calculation is deterministic and stores a policy snapshot', async () => {
    const sim = await payroll.post(`/payroll/${periodId}/simulate`);
    expect(sim.body.data.committed).toBe(false);
    expect(sim.body.data.policyIsTestOnly).toBe(true);
    expect(await PayrollEntry.countDocuments()).toBe(0);

    expect((await payroll.post(`/payroll/${periodId}/calculate`)).status).toBe(200);
    const first = (await payroll.get(`/payroll/${periodId}/entries?limit=50`)).body.data;
    expect(first).toHaveLength(8);
    expect(first[0].policyVersion).toBe(1);
    const totals = (await payroll.get(`/payroll/${periodId}/summary`)).body.data.period.totals;
    expect(totals.net + totals.deductions).toBe(totals.gross);
    expect(totals.employerCost).toBe(totals.gross + totals.employerContributions);

    // A rerun requires a reason and yields identical figures.
    expect((await payroll.post(`/payroll/${periodId}/calculate`)).status).toBe(400);
    expect((await payroll.post(`/payroll/${periodId}/calculate`, { reason: 'Verify determinism' })).status).toBe(200);
    const second = (await payroll.get(`/payroll/${periodId}/entries?limit=50`)).body.data;
    expect(second.map((e: { netPay: number }) => e.netPay)).toEqual(first.map((e: { netPay: number }) => e.netPay));
    expect(await PayrollEntry.countDocuments()).toBe(8); // no duplicates
  });

  it('flags employees without a salary revision instead of guessing', async () => {
    const hrRefs = (await hr.get('/employees?limit=1')).body.data[0];
    const created = await hr.post('/employees', { firstName: 'New', lastName: 'Joiner', workEmail: 'new.joiner@example.test', departmentId: hrRefs.departmentId._id, designationId: hrRefs.designationId._id, joiningDate: '2026-01-01', workLocation: 'Pune' });
    expect(created.status).toBe(201);
    await payroll.post(`/payroll/${periodId}/calculate`);
    const ex = (await payroll.get(`/payroll/${periodId}/exceptions`)).body.data;
    expect(ex).toHaveLength(1);
    expect(ex[0].exceptions[0].code).toBe('NO_SALARY_STRUCTURE');
    const submit = await payroll.post(`/payroll/${periodId}/submit`);
    expect(submit.status).toBe(409);
    expect((await payroll.post(`/payroll/${periodId}/submit`, { acknowledgeExceptions: true })).status).toBe(200);
  });

  it('rejects creating the same period twice', async () => {
    expect((await payroll.post('/payroll/periods', { year: 2026, month: 4 })).status).toBe(409);
  });

  it('blocks submit when inputs changed after calculation', async () => {
    await payroll.post(`/payroll/${periodId}/calculate`);
    await new Promise((r) => setTimeout(r, 20));
    await hr.post(`/payroll/${periodId}/inputs`, { employeeId: seeded.employees.Esha!.id, type: 'overtime', value: 100000 });
    expect((await payroll.post(`/payroll/${periodId}/submit`)).status).toBe(409);
  });
});

describe('approval workflow', () => {
  it('enforces transitions and permissions', async () => {
    expect((await payroll.post(`/payroll/${periodId}/submit`)).status).toBe(409); // not calculated yet
    expect((await finance.post(`/payroll/${periodId}/approve`)).status).toBe(409); // not pending
    await toPendingApproval(periodId);
    expect((await payroll.post(`/payroll/${periodId}/approve`)).status).toBe(403);
    expect((await emp.post(`/payroll/${periodId}/approve`)).status).toBe(403);
    expect((await mgr.post(`/payroll/${periodId}/approve`)).status).toBe(403);
    expect((await finance.post(`/payroll/${periodId}/finalize`)).status).toBe(403);
    expect((await finance.post(`/payroll/${periodId}/reject`, {})).status).toBe(400); // comment required
    expect((await finance.post(`/payroll/${periodId}/approve`)).status).toBe(200);
    expect((await payroll.post(`/payroll/${periodId}/finalize`)).status).toBe(200);
  });

  it('rejection returns the batch to a correctable state', async () => {
    await toPendingApproval(periodId);
    const rej = await finance.post(`/payroll/${periodId}/reject`, { comment: 'Overtime needs review' });
    expect(rej.body.data.status).toBe('rejected');
    expect((await hr.post(`/payroll/${periodId}/inputs`, { employeeId: seeded.employees.Ravi!.id, type: 'incentive', value: 100 })).status).toBe(201);
    expect((await payroll.post(`/payroll/${periodId}/calculate`, { reason: 'After rejection' })).status).toBe(200);
    expect((await payroll.post(`/payroll/${periodId}/submit`)).status).toBe(200);
    const history = (await payroll.get(`/payroll/${periodId}/summary`)).body.data.history.map((h: { action: string }) => h.action);
    expect(history).toEqual(['calculate', 'submit', 'reject', 'recalculate', 'submit']);
  });

  it('enforces segregation of duties for the preparer', async () => {
    await toPendingApproval(periodId);
    const finUser = await User.findOne({ email: 'finance@example.test' });
    await ApprovalRecord.create({ organizationId: seeded.org._id, periodId, action: 'submit', actorId: finUser!._id, fromStatus: 'calculated', toStatus: 'pending_approval' });
    const r = await finance.post(`/payroll/${periodId}/approve`);
    expect(r.status).toBe(403);
    expect(r.body.error.message).toMatch(/Segregation/);
  });

  it('lets only one of two concurrent approvals win', async () => {
    await toPendingApproval(periodId);
    const results = await Promise.all([finance.post(`/payroll/${periodId}/approve`), finance.post(`/payroll/${periodId}/approve`), finance.post(`/payroll/${periodId}/reject`, { comment: 'concurrent reject' })]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(2);
  });

  it('finalises exactly once under concurrency and creates one payslip per payable employee', async () => {
    await toPendingApproval(periodId);
    await finance.post(`/payroll/${periodId}/approve`);
    const results = await Promise.all([payroll.post(`/payroll/${periodId}/finalize`), payroll.post(`/payroll/${periodId}/finalize`), payroll.post(`/payroll/${periodId}/finalize`)]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(2);
    const slips = await payroll.get(`/payslips?periodId=${periodId}&limit=50`);
    expect(slips.body.meta.total).toBe(8);
  });
});

describe('finalised payroll immutability', () => {
  beforeEach(async () => {
    await toPendingApproval(periodId);
    await finance.post(`/payroll/${periodId}/approve`);
  });

  it('refuses edits, recalculation, cancellation and re-submission after approval and finalisation', async () => {
    const check = async () => {
      expect((await hr.post(`/payroll/${periodId}/inputs`, { employeeId: seeded.employees.Esha!.id, type: 'incentive', value: 1 })).status).toBe(409);
      expect((await payroll.post(`/payroll/${periodId}/calculate`, { reason: 'sneaky change' })).status).toBe(409);
      expect((await payroll.post(`/payroll/${periodId}/cancel`, { reason: 'sneaky cancel' })).status).toBe(409);
      expect((await payroll.post(`/payroll/${periodId}/submit`)).status).toBe(409);
      expect((await finance.post(`/payroll/${periodId}/reject`, { comment: 'late reject' })).status).toBe(409);
    };
    await check();
    expect((await payroll.post(`/payroll/${periodId}/finalize`)).status).toBe(200);
    await check();
  });

  it('runs payment, reconciliation and controlled adjustments end to end', async () => {
    await payroll.post(`/payroll/${periodId}/finalize`);
    const net = (await payroll.get(`/payroll/${periodId}/summary`)).body.data.period.totals.net;
    expect((await finance.post(`/payroll/${periodId}/payment-reference`, { reference: 'UTR123456', paymentDate: '2026-04-30', amount: net - 1 })).status).toBe(400);
    const pay = await finance.post(`/payroll/${periodId}/payment-reference`, { reference: 'UTR123456', paymentDate: '2026-04-30', amount: net });
    expect(pay.status).toBe(201);
    expect(pay.body.data.period.status).toBe('reconciliation_pending');
    expect((await finance.post(`/payroll/${periodId}/payment-reference`, { reference: 'UTR999999', paymentDate: '2026-04-30', amount: net })).status).toBe(409);

    // Correction flows through a later period, never by editing the finalised one.
    const may = await newPeriod(2026, 5);
    const esha = seeded.employees.Esha!.id;
    const adj = await payroll.post(`/payroll/${periodId}/adjustments`, { employeeId: esha, targetPeriodId: may, amount: 250000, reason: 'Missed April allowance' });
    expect(adj.status).toBe(201);
    expect((await payroll.post(`/payroll/adjustments/${adj.body.data._id}/review`, { decision: 'approved' })).status).toBe(403); // no approve permission
    expect((await finance.post(`/payroll/adjustments/${adj.body.data._id}/review`, { decision: 'approved' })).status).toBe(200);
    const sim = await payroll.post(`/payroll/${may}/simulate`);
    const row = sim.body.data.entries.find((e: { employeeId: string }) => e.employeeId === esha);
    expect(row.additionalEarnings.map((l: { amount: number }) => l.amount)).toContain(250000);

    expect((await finance.post(`/payroll/${periodId}/reconcile`)).status).toBe(200);
    expect((await payroll.get(`/payroll/periods`)).body.data.find((p: { _id: string }) => p._id === periodId).status).toBe('reconciled');
  });
});

describe('payslips and self-service', () => {
  beforeEach(async () => {
    await toPendingApproval(periodId);
    await finance.post(`/payroll/${periodId}/approve`);
    await payroll.post(`/payroll/${periodId}/finalize`);
  });

  it('lets an employee download only their own payslip PDF', async () => {
    const mine = await emp.get('/payslips');
    expect(mine.body.data).toHaveLength(1);
    const id = mine.body.data[0]._id;
    const pdf = await emp.get(`/payslips/${id}/pdf`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.headers['cache-control']).toMatch(/no-store/);
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');

    const all = (await payroll.get('/payslips?limit=50')).body.data;
    const others = all.filter((s: { employeeId: string }) => s.employeeId !== mine.body.data[0].employeeId);
    expect(others.length).toBeGreaterThan(0);
    for (const o of others) {
      expect((await emp.get(`/payslips/${o._id}`)).status).toBe(404);
      expect((await emp.get(`/payslips/${o._id}/pdf`)).status).toBe(404);
    }
    expect((await emp.get(`/payslips?employeeId=${others[0].employeeId}`)).body.data.every((s: { employeeId: string }) => s.employeeId === mine.body.data[0].employeeId)).toBe(true);
    // Staff with their own employee record see only their own payslip, never anyone else's.
    for (const c of [mgr, hr, admin]) {
      const own = (await c.get('/payslips')).body.data;
      expect(own).toHaveLength(1);
      expect(own[0]._id).not.toBe(id);
      expect((await c.get(`/payslips/${id}`)).status).toBe(404);
    }
    expect((await payroll.get(`/payslips/${id}/pdf`)).status).toBe(200);
  });

  it('serves the employee dashboard, annual summary and correction requests', async () => {
    const dash = await emp.get('/me/dashboard');
    expect(dash.body.data.netPayHistory).toHaveLength(1);
    expect(dash.body.data.latest.deductions.length).toBeGreaterThan(0);
    const annual = await emp.get('/me/annual-summary');
    expect(annual.body.data.financialYear).toBe(2026);
    expect(annual.body.data.net).toBe(dash.body.data.latest.net);

    const req = await emp.post('/me/correction-requests', { subject: 'Wrong PT', description: 'Professional tax looks incorrect for April.', periodId });
    expect(req.status).toBe(201);
    expect((await emp.get('/me/correction-requests')).body.data).toHaveLength(1);
    expect((await emp.patch(`/correction-requests/${req.body.data._id}`, { status: 'resolved', reviewNote: 'self' })).status).toBe(403);
    // Esha reports to Meera, so the manager can review; payroll can too.
    const reviewed = await mgr.patch(`/correction-requests/${req.body.data._id}`, { status: 'approved', reviewNote: 'Will correct in next run' });
    expect(reviewed.status).toBe(200);
    expect((await hr.get('/correction-requests')).status).toBe(403);
  });
});

describe('reports', () => {
  it('returns database-backed aggregates for finalised payroll and respects roles', async () => {
    await toPendingApproval(periodId);
    await finance.post(`/payroll/${periodId}/approve`);
    const summary = await finance.get('/reports/payroll-summary?fy=2026');
    expect(summary.body.data).toHaveLength(1);
    const totals = (await payroll.get(`/payroll/${periodId}/summary`)).body.data.period.totals;
    expect(summary.body.data[0].grossPaise).toBe(totals.gross);
    const depts = (await finance.get('/reports/department-costs?fy=2026')).body.data;
    expect(depts.reduce((a: number, d: { grossPaise: number }) => a + d.grossPaise, 0)).toBe(totals.gross);
    const ded = (await finance.get('/reports/deductions?fy=2026')).body.data;
    expect(ded.reduce((a: number, d: { totalPaise: number }) => a + d.totalPaise, 0)).toBe(totals.deductions);
    expect((await finance.get('/reports/headcount')).body.data.length).toBeGreaterThan(0);
    const csv = await finance.get('/reports/payroll-summary?fy=2026&format=csv');
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect((await emp.get('/reports/headcount')).status).toBe(403);
    expect((await hr.get('/reports/deductions')).status).toBe(403);
    expect((await finance.get('/reports/payroll-summary?fy=2025')).body.data).toHaveLength(0);
  });
});

describe('audit trail', () => {
  it('records privileged actions without sensitive data and is append-only', async () => {
    await toPendingApproval(periodId);
    await finance.post(`/payroll/${periodId}/approve`);
    const hrRefs = (await hr.get('/employees?limit=1')).body.data[0];
    await hr.patch(`/employees/${hrRefs._id}`, { bank: { accountHolder: 'X Y', accountNumber: '998877665544', ifsc: 'SBIN0001234' } });
    await finance.get('/reports/payroll-summary?format=csv');

    const logs = await admin.get('/audit-logs?limit=100');
    expect(logs.status).toBe(200);
    const actions = logs.body.data.map((l: { action: string }) => l.action);
    expect(actions).toEqual(expect.arrayContaining(['auth.login', 'payroll.calculate', 'payroll.submit', 'payroll.approve', 'employee.update', 'report.export']));
    expect(JSON.stringify(logs.body)).not.toMatch(/998877665544|passwordHash|SBIN0001234/);
    const approve = logs.body.data.find((l: { action: string }) => l.action === 'payroll.approve');
    expect(approve.actorId.email).toBe('finance@example.test');

    await expect(AuditLog.updateOne({}, { action: 'tampered' })).rejects.toThrow(/append-only/);
    await expect(AuditLog.deleteMany({})).rejects.toThrow(/append-only/);
    await expect(ApprovalRecord.deleteMany({})).rejects.toThrow(/immutable/);
    expect((await admin.post('/audit-logs', {})).status).toBe(404);
  });
});

describe('organisation isolation', () => {
  it('keeps a second organisation entirely separate', async () => {
    // Build a second org by cloning the seed with different emails.
    await mongoose.connection.collection('users').updateMany({}, [{ $set: { email: { $concat: ['org1.', '$email'] } } }]);
    const second = await seedDemo(PASSWORD);
    expect(second.org.id).not.toBe(seeded.org.id);

    const otherPayroll = await loginAs(app, 'payroll@example.test');
    const otherHr = await loginAs(app, 'hr@example.test');
    // Org 2 sees no org-1 period; the id from org 1 is simply not found.
    expect((await otherPayroll.get(`/payroll/${periodId}/summary`)).status).toBe(404);
    expect((await otherPayroll.post(`/payroll/${periodId}/calculate`)).status).toBe(404);
    expect((await otherPayroll.get('/payroll/periods')).body.data).toHaveLength(0);
    const org1Emp = seeded.employees.Esha!.id;
    expect((await otherHr.get(`/employees/${org1Emp}`)).status).toBe(404);
    expect((await otherHr.patch(`/employees/${org1Emp}`, { firstName: 'Hijack' })).status).toBe(404);
    expect((await otherHr.get('/employees?limit=50')).body.meta.total).toBe(8);
    // Cross-org references in request bodies are rejected.
    const dept = (await otherHr.get('/departments')).body.data[0]._id;
    const org1Dept = seeded.departments[0]!.id;
    const body = { firstName: 'A', lastName: 'B', workEmail: 'a.b@example.test', designationId: seeded.designations[0]!.id, departmentId: dept, joiningDate: '2026-01-01', workLocation: 'X' };
    expect((await otherHr.post('/employees', body)).status).toBe(400);
    expect((await otherHr.post('/employees', { ...body, departmentId: org1Dept })).status).toBe(400);
  });
});
