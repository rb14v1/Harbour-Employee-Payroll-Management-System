import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app as makeApp, loginAs, PASSWORD, resetAndSeed, startDb, stopDb } from './helpers.js';

const app = makeApp();

beforeAll(async () => {
  await startDb();
  await resetAndSeed();
});
afterAll(stopDb);

describe('authentication', () => {
  it('rejects bad credentials with a generic message', async () => {
    const r = await request(app).post('/api/v1/auth/login').send({ email: 'hr@example.test', password: 'wrong-password-1' });
    expect(r.status).toBe(401);
    expect(r.body.error.message).toBe('Invalid email or password');
    const r2 = await request(app).post('/api/v1/auth/login').send({ email: 'nobody@example.test', password: 'wrong-password-1' });
    expect(r2.body.error.message).toBe(r.body.error.message);
  });

  it('sets an httpOnly cookie and never returns the password hash', async () => {
    const r = await request(app).post('/api/v1/auth/login').send({ email: 'hr@example.test', password: PASSWORD });
    expect(r.status).toBe(200);
    expect(String(r.headers['set-cookie'])).toMatch(/HttpOnly/i);
    expect(JSON.stringify(r.body)).not.toMatch(/passwordHash|argon2/);
  });

  it('requires authentication and CSRF token', async () => {
    expect((await request(app).get('/api/v1/employees')).status).toBe(401);
    const agent = request.agent(app);
    await agent.post('/api/v1/auth/login').send({ email: 'hr@example.test', password: PASSWORD });
    const r = await agent.post('/api/v1/departments').send({ name: 'Ops', code: 'OPS' });
    expect(r.status).toBe(403);
    expect(r.body.error.message).toMatch(/CSRF/);
  });

  it('revokes the session on logout', async () => {
    const agent = request.agent(app);
    const login = await agent.post('/api/v1/auth/login').send({ email: 'hr@example.test', password: PASSWORD });
    const csrf = login.body.data.csrfToken as string;
    expect((await agent.get('/api/v1/auth/me')).status).toBe(200);
    expect((await agent.post('/api/v1/auth/logout').set('X-CSRF-Token', csrf)).status).toBe(204);
    // Replaying the old cookie must fail even though the JWT itself is still unexpired.
    const cookie = login.headers['set-cookie'];
    expect((await request(app).get('/api/v1/auth/me').set('Cookie', cookie!)).status).toBe(401);
  });

  it('locks the account after repeated failures', async () => {
    for (let i = 0; i < 5; i++) await request(app).post('/api/v1/auth/login').send({ email: 'finance@example.test', password: 'wrong-password-1' });
    const r = await request(app).post('/api/v1/auth/login').send({ email: 'finance@example.test', password: PASSWORD });
    expect(r.status).toBe(401);
  });

  it('resets a password and revokes existing sessions', async () => {
    const old = await loginAs(app, 'admin@example.test');
    const f = await request(app).post('/api/v1/auth/forgot-password').send({ email: 'admin@example.test' });
    expect(f.status).toBe(200);
    const unknown = await request(app).post('/api/v1/auth/forgot-password').send({ email: 'ghost@example.test' });
    expect(unknown.body.data.message).toBe(f.body.data.message);
    const weak = await request(app).post('/api/v1/auth/reset-password').send({ token: f.body.devToken, newPassword: 'short' });
    expect(weak.status).toBe(400);
    const ok = await request(app).post('/api/v1/auth/reset-password').send({ token: f.body.devToken, newPassword: 'Brand-New-Pass-456' });
    expect(ok.status).toBe(200);
    expect((await old.get('/auth/me')).status).toBe(401);
    const reuse = await request(app).post('/api/v1/auth/reset-password').send({ token: f.body.devToken, newPassword: 'Another-Pass-789x' });
    expect(reuse.status).toBe(400);
    await loginAs(app, 'admin@example.test', 'Brand-New-Pass-456');
  });
});

describe('role-based authorisation', () => {
  it('blocks roles from endpoints outside their permissions', async () => {
    const emp = await loginAs(app, 'employee@example.test');
    const hr = await loginAs(app, 'hr@example.test');
    const payroll = await loginAs(app, 'payroll@example.test');
    expect((await emp.get('/audit-logs')).status).toBe(403);
    expect((await emp.get('/payroll/periods')).status).toBe(403);
    expect((await emp.post('/employees', {})).status).toBe(403);
    expect((await emp.get('/reports/payroll-summary')).status).toBe(403);
    expect((await hr.get('/payroll/periods')).status).toBe(200);
    expect((await hr.post('/payroll/periods', { year: 2026, month: 4 })).status).toBe(403);
    expect((await payroll.post('/employees', {})).status).toBe(403);
    expect((await payroll.get('/audit-logs')).status).toBe(403);
  });

  it('limits employees to their own record and managers to their reports', async () => {
    const emp = await loginAs(app, 'employee@example.test');
    const list = await emp.get('/employees');
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].firstName).toBe('Esha');

    const mgr = await loginAs(app, 'manager@example.test');
    const team = await mgr.get('/employees?limit=50');
    const names = team.body.data.map((e: { firstName: string }) => e.firstName).sort();
    expect(names).toEqual(['Esha', 'Meera', 'Nikhil', 'Ravi']);

    const hr = await loginAs(app, 'hr@example.test');
    const all = await hr.get('/employees?limit=50');
    const hari = all.body.data.find((e: { firstName: string }) => e.firstName === 'Priya');
    // Out-of-scope ids return 404 so existence is not leaked.
    expect((await emp.get(`/employees/${hari._id}`)).status).toBe(404);
    expect((await mgr.get(`/employees/${hari._id}`)).status).toBe(404);
    expect((await emp.get(`/employees/${hari._id}/payroll-history`)).status).toBe(404);
  });

  it('hides sensitive identifiers from list responses and masks them in detail', async () => {
    const hr = await loginAs(app, 'hr@example.test');
    const all = await hr.get('/employees?limit=50');
    const target = all.body.data.find((e: { firstName: string }) => e.firstName === 'Ravi'); // a report of the manager, not the manager
    const patch = await hr.patch(`/employees/${target._id}`, { bank: { accountHolder: 'Test Person', accountNumber: '123456789012', ifsc: 'HDFC0001234' }, panNumber: 'ABCDE1234F' });
    expect(patch.status).toBe(200);
    expect(JSON.stringify((await hr.get('/employees?limit=50')).body)).not.toMatch(/123456789012|ABCDE1234F/);
    const detail = await hr.get(`/employees/${target._id}`);
    expect(detail.body.data.bank.accountNumberMasked).toBe('********9012');
    expect(JSON.stringify(detail.body)).not.toContain('123456789012');
    const mgr = await loginAs(app, 'manager@example.test');
    const mgrView = await mgr.get(`/employees/${target._id}`);
    expect(JSON.stringify(mgrView.body)).not.toMatch(/bank|panMasked/);
  });

  it('rejects NoSQL operators and unknown ids', async () => {
    const hr = await loginAs(app, 'hr@example.test');
    const base = await hr.get('/employees');
    const injected = await hr.get('/employees?status[$ne]=active&q[$regex]=.*');
    expect(injected.status).toBe(200); // unknown/operator keys are stripped, never passed to the query
    expect(injected.body.meta.total).toBe(base.body.meta.total);
    expect((await hr.get('/employees/not-an-id')).status).toBe(400);
    expect((await request(app).post('/api/v1/auth/login').send({ email: { $ne: '' }, password: { $ne: '' } })).status).toBe(400);
  });

  it('ignores mass-assigned fields on employee create', async () => {
    const hr = await loginAs(app, 'hr@example.test');
    const refs = (await hr.get('/employees?limit=1')).body.data[0];
    const r = await hr.post('/employees', {
      firstName: 'Zed', lastName: 'Test', workEmail: 'zed@example.test', departmentId: refs.departmentId._id, designationId: refs.designationId._id,
      joiningDate: '2026-01-01', workLocation: 'Pune', organizationId: '000000000000000000000000', employeeCode: 'HACK1',
    });
    expect(r.status).toBe(201);
    expect(r.body.data.employeeCode).toMatch(/^EMP\d{5}$/);
    expect(r.body.data.organizationId).not.toBe('000000000000000000000000');
  });
});
