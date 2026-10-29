import { useQuery } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, Input, Loading, Modal, Notice, PageHeader, Pagination, Stat, Table, Td, Th } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthContext';
import { useAction, useList } from '@/hooks/useApi';
import { api, type One } from '@/lib/api';
import { date, dateTime, label, money } from '@/lib/format';
import { can } from '@/lib/permissions';
import type { Entry, Period, Totals } from '@/types';

export function PayrollPeriodsPage() {
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const list = useList<Period>('/payroll/periods', { page, limit: 12 });
  const create = useAction(() => api.post('/payroll/periods', { year, month }), [['/payroll/periods']]);
  return (
    <>
      <PageHeader title="Payroll processing" description="One batch per month. Calculate, review exceptions, submit for approval, finalise and record payment." actions={can.preparePayroll(user!.role) && <Button onClick={() => setOpen(true)}>New payroll period</Button>} />
      <Card>
        {list.isLoading ? <Loading /> : list.isError ? <ErrorState error={list.error} /> : !list.data?.data.length ? <EmptyState title="No payroll periods" hint="Create the first period to begin." /> : (
          <>
            <Table><thead><tr><Th>Period</Th><Th>Dates</Th><Th>Status</Th><Th right>Employees</Th><Th right>Net payable</Th><Th right>Exceptions</Th></tr></thead>
              <tbody>{list.data.data.map((p) => <tr key={p._id}><Td><Link className="font-medium text-brand-700 hover:underline" to={`/payroll/${p._id}`}>{p.name}</Link></Td><Td>{date(p.startDate)} – {date(p.endDate)}</Td><Td><Badge value={p.status} /></Td><Td right>{p.totals?.payableCount ?? 0}</Td><Td right>{money(p.totals?.net)}</Td><Td right>{p.totals?.exceptionCount ?? 0}</Td></tr>)}</tbody></Table>
            <Pagination page={list.data.meta.page} totalPages={list.data.meta.totalPages} total={list.data.meta.total} onPage={setPage} />
          </>
        )}
      </Card>
      <Modal open={open} title="New payroll period" onClose={() => setOpen(false)}>
        <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); await create.mutateAsync(undefined); setOpen(false); }}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Year" htmlFor="np-y"><Input id="np-y" type="number" min={2000} max={2100} value={year} onChange={(e) => setYear(Number(e.target.value))} /></Field>
            <Field label="Month" htmlFor="np-m"><Input id="np-m" type="number" min={1} max={12} value={month} onChange={(e) => setMonth(Number(e.target.value))} /></Field>
          </div>
          {create.isError && <ErrorState error={create.error} />}
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" loading={create.isPending}>Create</Button></div>
        </form>
      </Modal>
    </>
  );
}

type ActionKey = 'calculate' | 'submit' | 'approve' | 'reject' | 'finalize' | 'cancel' | 'reconcile';
interface Summary { period: Period; byDepartment: { department: string; headcount: number; gross: number; net: number; employerCost: number }[]; byDeduction: { code: string; name: string; total: number }[]; history: { _id: string; action: string; actorRole: string; comment?: string; fromStatus: string; toStatus: string; createdAt: string }[] }

const STEPS = ['draft', 'calculated', 'pending_approval', 'approved', 'payment_processing', 'reconciliation_pending', 'reconciled'];

export function PayrollBatchPage() {
  const { periodId } = useParams();
  const { user } = useAuth();
  const role = user!.role;
  const summary = useQuery({ queryKey: ['/payroll', periodId, 'summary'], queryFn: async () => (await api.get<One<Summary>>(`/payroll/${periodId}/summary`)).data });
  const [page, setPage] = useState(1);
  const [onlyEx, setOnlyEx] = useState(false);
  const entries = useList<Entry>(`/payroll/${periodId}/entries`, { page, limit: 15, exceptionsOnly: onlyEx ? 'true' : undefined });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [dialog, setDialog] = useState<ActionKey | 'payment' | null>(null);
  const [ack, setAck] = useState(false);
  const [sim, setSim] = useState<{ totals: Totals; policyIsTestOnly: boolean | null; policyVersion: number | null } | null>(null);
  const [pay, setPay] = useState({ reference: '', paymentDate: new Date().toISOString().slice(0, 10) });
  const inv = [['/payroll', periodId, 'summary'], [`/payroll/${periodId}/entries`], ['/payroll/periods']];
  const act = useAction(async (v: { key: ActionKey; comment: string }) => {
    const bodies: Record<ActionKey, object> = { calculate: { reason: v.comment || undefined }, submit: { comment: v.comment || undefined, acknowledgeExceptions: ack }, approve: { comment: v.comment || undefined }, reject: { comment: v.comment }, finalize: {}, cancel: { reason: v.comment }, reconcile: { note: v.comment || undefined } };
    return api.post(`/payroll/${periodId}/${v.key}`, bodies[v.key]);
  }, inv);
  const simulate = useAction(async () => (await api.post<One<{ totals: Totals; policyIsTestOnly: boolean | null; policyVersion: number | null }>>(`/payroll/${periodId}/simulate`)).data);
  const payment = useAction(() => api.post(`/payroll/${periodId}/payment-reference`, { reference: pay.reference, paymentDate: pay.paymentDate, amount: summary.data!.period.totals.net }), inv);

  if (summary.isLoading) return <Loading />;
  if (summary.isError) return <ErrorState error={summary.error} />;
  const { period: p, byDepartment, byDeduction, history } = summary.data!;
  const st = p.status;
  const t = p.totals;
  const close = () => { setDialog(null); act.reset(); payment.reset(); };
  const run = async (key: ActionKey, comment: string) => { await act.mutateAsync({ key, comment }); close(); setAck(false); };
  const step = STEPS.indexOf(st);

  const meta: Record<ActionKey, { title: string; message: string; label: string; comment?: 'optional' | 'required'; danger?: boolean }> = {
    calculate: { title: p.calculationRun ? 'Recalculate payroll' : 'Calculate payroll', message: p.calculationRun ? 'Existing figures are replaced and the recalculation is audited.' : 'Runs the calculation engine for all eligible employees using approved inputs only.', label: p.calculationRun ? 'Recalculate' : 'Calculate', comment: p.calculationRun ? 'required' : 'optional' },
    submit: { title: 'Submit for approval', message: 'The batch becomes read-only until it is approved or rejected.', label: 'Submit', comment: 'optional' },
    approve: { title: 'Approve payroll batch', message: `Approve ${t.payableCount} payslips totalling ${money(t.net)} net. Approved figures cannot be edited.`, label: 'Approve', comment: 'optional' },
    reject: { title: 'Reject payroll batch', message: 'The batch returns to the preparer for correction.', label: 'Reject', comment: 'required', danger: true },
    finalize: { title: 'Finalise payroll', message: 'Locks the batch and generates payslips for every payable employee. This cannot be reversed; later fixes go through adjustments.', label: 'Finalise' },
    cancel: { title: 'Cancel payroll batch', message: 'Cancelled batches cannot be reopened.', label: 'Cancel batch', comment: 'required', danger: true },
    reconcile: { title: 'Mark as reconciled', message: 'Confirms the bank payment matches this batch.', label: 'Reconcile', comment: 'optional' },
  };

  return (
    <>
      <PageHeader title={`Payroll ${p.name}`} description={`${date(p.startDate)} – ${date(p.endDate)} · cut-off ${date(p.cutoffDate)} · run ${p.calculationRun}`} actions={<Badge value={st} />} />
      <ol className="mb-4 flex flex-wrap gap-2 text-xs" aria-label="Workflow progress">
        {STEPS.map((s, i) => <li key={s} className={`rounded-full px-3 py-1 ${i <= step && st !== 'rejected' && st !== 'cancelled' ? 'bg-brand-600 text-white' : 'bg-slate-200 text-slate-600'}`}>{label(s)}</li>)}
        {(st === 'rejected' || st === 'cancelled') && <li className="rounded-full bg-red-100 px-3 py-1 text-red-800">{label(st)}</li>}
      </ol>

      <div className="mb-4 flex flex-wrap gap-2">
        {can.preparePayroll(role) && ['draft', 'calculated', 'rejected'].includes(st) && <>
          <Button variant="secondary" loading={simulate.isPending} onClick={async () => setSim(await simulate.mutateAsync(undefined))}>Preview (simulate)</Button>
          <Button onClick={() => setDialog('calculate')}>{p.calculationRun ? 'Recalculate' : 'Calculate'}</Button>
          {st === 'calculated' && <Button onClick={() => setDialog('submit')}>Submit for approval</Button>}
          <Button variant="ghost" onClick={() => setDialog('cancel')}>Cancel batch</Button>
        </>}
        {can.approvePayroll(role) && st === 'pending_approval' && <><Button onClick={() => setDialog('approve')}>Approve</Button><Button variant="danger" onClick={() => setDialog('reject')}>Reject</Button></>}
        {can.finalizePayroll(role) && st === 'approved' && <Button onClick={() => setDialog('finalize')}>Finalise and generate payslips</Button>}
        {can.recordPayment(role) && st === 'payment_processing' && <Button onClick={() => setDialog('payment')}>Record payment</Button>}
        {can.recordPayment(role) && st === 'reconciliation_pending' && <Button onClick={() => setDialog('reconcile')}>Mark reconciled</Button>}
      </div>
      {act.isError && !dialog && <div className="mb-4"><ErrorState error={act.error} /></div>}
      {sim && <div className="mb-4"><Notice tone="amber">Simulation only, nothing saved: gross-to-net total {money(sim.totals.net)} for {sim.totals.payableCount} payable employees, {sim.totals.exceptionCount} with exceptions.{sim.policyIsTestOnly ? ' Policy version is TEST-ONLY (not verified statutory rules).' : ''}</Notice></div>}

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Payable employees" value={t.payableCount} hint={`${t.employeeCount} in period`} />
        <Stat label="Gross earnings" value={money(t.gross)} />
        <Stat label="Total deductions" value={money(t.deductions)} />
        <Stat label="Net payable" value={money(t.net)} />
        <Stat label="Employer contributions" value={money(t.employerContributions)} />
        <Stat label="Total employer cost" value={money(t.employerCost)} />
        <Stat label="Employees with exceptions" value={t.exceptionCount} />
        <Stat label="Payment" value={label(p.paymentStatus)} hint={`Reconciliation: ${label(p.reconciliationStatus)}`} />
      </div>

      <Card title="Employee entries" className="mb-4" actions={<label className="flex items-center gap-2 text-sm font-normal"><input type="checkbox" checked={onlyEx} onChange={(e) => { setOnlyEx(e.target.checked); setPage(1); }} />Exceptions only</label>}>
        {entries.isLoading ? <Loading /> : entries.isError ? <ErrorState error={entries.error} /> : !entries.data?.data.length ? <EmptyState title="No entries yet" hint="Calculate the batch to generate entries." /> : (
          <>
            <Table><thead><tr><Th>Employee</Th><Th>Department</Th><Th right>Paid days</Th><Th right>Gross</Th><Th right>Deductions</Th><Th right>Net</Th><Th>Flags</Th></tr></thead>
              <tbody>{entries.data.data.map((e) => (
                <Fragment key={e._id}>
                  <tr className="cursor-pointer hover:bg-slate-50" onClick={() => setExpanded(expanded === e._id ? null : e._id)}>
                    <Td><button className="text-left font-medium text-brand-700" aria-expanded={expanded === e._id}>{e.snapshot.name}</button><div className="text-xs text-slate-500">{e.snapshot.employeeCode}</div></Td>
                    <Td>{e.snapshot.departmentName}</Td><Td right>{e.payableDays}/{e.totalDays}</Td><Td right>{money(e.grossEarnings)}</Td><Td right>{money(e.totalEmployeeDeductions)}</Td><Td right>{money(e.netPay)}</Td>
                    <Td>{e.exceptions.map((x) => <Badge key={x.code} value={x.severity} />)}{!e.payable && <span className="ml-1 text-xs text-red-700">excluded</span>}</Td>
                  </tr>
                  {expanded === e._id && (
                    <tr><td colSpan={7} className="bg-slate-50 px-4 py-3">
                      <div className="grid gap-4 text-sm md:grid-cols-3">
                        <div><h3 className="mb-1 font-semibold">Earnings</h3>{[...e.earnings, ...e.additionalEarnings].map((l, i) => <p key={i} className="flex justify-between"><span>{l.name}</span><span className="tabular-nums">{money(l.amount)}</span></p>)}</div>
                        <div><h3 className="mb-1 font-semibold">Deductions</h3>{e.employeeDeductions.length ? e.employeeDeductions.map((l, i) => <p key={i} className="flex justify-between"><span>{l.name}</span><span className="tabular-nums">{money(l.amount)}</span></p>) : <p className="text-slate-500">None</p>}</div>
                        <div><h3 className="mb-1 font-semibold">Employer contributions</h3>{e.employerContributions.length ? e.employerContributions.map((l, i) => <p key={i} className="flex justify-between"><span>{l.name}</span><span className="tabular-nums">{money(l.amount)}</span></p>) : <p className="text-slate-500">None</p>}<p className="mt-1 text-xs text-slate-500">Policy v{e.policyVersion ?? '-'}</p></div>
                      </div>
                      {e.exceptions.length > 0 && <ul className="mt-3 space-y-1 text-sm">{e.exceptions.map((x) => <li key={x.code} className={x.severity === 'error' ? 'text-red-800' : 'text-amber-900'}><strong>{x.code}</strong>: {x.message}</li>)}</ul>}
                    </td></tr>
                  )}
                </Fragment>))}</tbody></Table>
            <Pagination page={entries.data.meta.page} totalPages={entries.data.meta.totalPages} total={entries.data.meta.total} onPage={setPage} />
          </>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="By department">{byDepartment.length === 0 ? <EmptyState title="No data" /> : <Table><thead><tr><Th>Department</Th><Th right>Headcount</Th><Th right>Net</Th></tr></thead><tbody>{byDepartment.map((d) => <tr key={d.department}><Td>{d.department}</Td><Td right>{d.headcount}</Td><Td right>{money(d.net)}</Td></tr>)}</tbody></Table>}</Card>
        <Card title="Deductions by category">{byDeduction.length === 0 ? <EmptyState title="No deductions" /> : <Table><thead><tr><Th>Item</Th><Th right>Total</Th></tr></thead><tbody>{byDeduction.map((d) => <tr key={d.code}><Td>{d.name}</Td><Td right>{money(d.total)}</Td></tr>)}</tbody></Table>}</Card>
        <Card title="Approval history">{history.length === 0 ? <EmptyState title="No actions yet" /> : <ol className="space-y-2 text-sm">{history.map((h) => <li key={h._id}><span className="font-medium">{label(h.action)}</span> by {label(h.actorRole)}<div className="text-xs text-slate-500">{dateTime(h.createdAt)} · {label(h.fromStatus)} → {label(h.toStatus)}</div>{h.comment && <div className="text-xs">“{h.comment}”</div>}</li>)}</ol>}</Card>
      </div>

      {dialog && dialog !== 'payment' && (
        <ConfirmDialog open title={meta[dialog].title} confirmLabel={meta[dialog].label} danger={meta[dialog].danger} withComment={Boolean(meta[dialog].comment)} commentRequired={meta[dialog].comment === 'required'} commentLabel={dialog === 'calculate' ? 'Reason' : 'Comment'} loading={act.isPending} error={act.error} onClose={close} onConfirm={(c) => void run(dialog, c)}
          message={<><p>{meta[dialog].message}</p>{dialog === 'submit' && t.exceptionCount > 0 && <label className="mt-3 flex items-start gap-2"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-1" />Employees with blocking exceptions will be excluded from this batch. I have reviewed them.</label>}</>} />
      )}
      <Modal open={dialog === 'payment'} title="Record payment" onClose={close}>
        <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); await payment.mutateAsync(undefined); close(); }}>
          <p className="text-sm text-slate-700">Payment amount is the batch net payable: <strong>{money(t.net)}</strong>.</p>
          <Field label="Payment reference (e.g. UTR)" htmlFor="pr-r"><Input id="pr-r" required minLength={3} value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} /></Field>
          <Field label="Payment date" htmlFor="pr-d"><Input id="pr-d" type="date" required value={pay.paymentDate} onChange={(e) => setPay({ ...pay, paymentDate: e.target.value })} /></Field>
          {payment.isError && <ErrorState error={payment.error} />}
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={close}>Cancel</Button><Button type="submit" loading={payment.isPending}>Record payment</Button></div>
        </form>
      </Modal>
    </>
  );
}
