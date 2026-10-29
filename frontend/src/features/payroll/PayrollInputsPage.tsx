import { Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, Loading, Notice, PageHeader, Pagination, Select, Table, Td, Th } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthContext';
import { useAction, useList } from '@/hooks/useApi';
import { api, type One } from '@/lib/api';
import { label, money, rupeesToPaise } from '@/lib/format';
import type { Employee, Period } from '@/types';

interface InputRow { _id: string; employeeId: { _id: string; employeeCode: string; firstName: string; lastName: string }; type: string; value: number; description?: string; source: string; status: string; enteredBy: string }
const TYPES = ['unpaid_leave', 'overtime', 'variable_pay', 'incentive', 'deduction', 'adjustment'] as const;
const EDITABLE = ['draft', 'calculated', 'rejected'];

export function PayrollInputsPage() {
  const { user } = useAuth();
  const periods = useList<Period>('/payroll/periods', { limit: 24 });
  const employees = useList<Employee>('/employees', { limit: 100 });
  const [periodId, setPeriodId] = useState('');
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [form, setForm] = useState({ employeeId: '', type: 'incentive' as (typeof TYPES)[number], value: '', description: '' });
  const [importMsg, setImportMsg] = useState<{ tone: 'green' | 'red'; text: string } | null>(null);
  const [importErr, setImportErr] = useState<unknown>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const current = periodId || periods.data?.data[0]?._id || '';
  const period = periods.data?.data.find((p) => p._id === current);
  const locked = period ? !EDITABLE.includes(period.status) : true;
  const list = useList<InputRow>(`/payroll/${current}/inputs`, { page, limit: 15, status: status || undefined }, Boolean(current));
  const keys = [[`/payroll/${current}/inputs`]];
  const add = useAction(() => api.post(`/payroll/${current}/inputs`, { employeeId: form.employeeId, type: form.type, description: form.description || undefined, value: form.type === 'unpaid_leave' ? Number(form.value) : rupeesToPaise(form.value) }), keys);
  const review = useAction((v: { id: string; decision: 'approved' | 'rejected' }) => api.post(`/payroll/inputs/${v.id}/review`, { decision: v.decision }), keys);

  return (
    <>
      <PageHeader title="Attendance and payroll inputs" description="Inputs count towards payroll only after a second person approves them." />
      <Card className="mb-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Payroll period" htmlFor="pi-p"><Select id="pi-p" value={current} onChange={(e) => { setPeriodId(e.target.value); setPage(1); }}>{periods.data?.data.map((p) => <option key={p._id} value={p._id}>{p.name} ({label(p.status)})</option>)}</Select></Field>
          <Field label="Status" htmlFor="pi-s"><Select id="pi-s" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">All</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option></Select></Field>
          <div className="flex items-end">
            <input ref={fileRef} hidden type="file" accept=".csv" aria-label="Import inputs CSV" onChange={async (e) => {
              const f = e.target.files?.[0]; e.target.value = ''; if (!f) return;
              setImportMsg(null); setImportErr(null);
              try { const r = await api.upload<One<{ created: number }>>(`/payroll/${current}/inputs/import`, f); setImportMsg({ tone: 'green', text: `Imported ${r.data.created} input(s) as pending.` }); await list.refetch(); } catch (err) { setImportErr(err); }
            }} />
            <Button variant="secondary" disabled={locked} onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4" />Import CSV</Button>
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-500">CSV columns: employeeCode, type, value, description. Money in rupees; unpaid_leave in days (0.5 steps). A file with any invalid row is rejected in full.</p>
        {importMsg && <div className="mt-2"><Notice tone={importMsg.tone}>{importMsg.text}</Notice></div>}
        {importErr ? <div className="mt-2"><ErrorState error={importErr} /></div> : null}
      </Card>

      {!current ? <EmptyState title="No payroll period yet" hint="Create a period under Payroll Processing first." /> : (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="Add input" className="lg:col-span-1">
            {locked ? <Notice tone="amber">Inputs are locked while the period is "{label(period?.status)}".</Notice> : (
              <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); await add.mutateAsync(undefined); setForm({ ...form, value: '', description: '' }); }}>
                <Field label="Employee" htmlFor="ai-e"><Select id="ai-e" required value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })}><option value="">Select…</option>{employees.data?.data.map((e) => <option key={e._id} value={e._id}>{e.employeeCode} · {e.firstName} {e.lastName}</option>)}</Select></Field>
                <Field label="Type" htmlFor="ai-t"><Select id="ai-t" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as (typeof TYPES)[number] })}>{TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}</Select></Field>
                <Field label={form.type === 'unpaid_leave' ? 'Days' : 'Amount (₹)'} htmlFor="ai-v"><Input id="ai-v" required inputMode="decimal" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} /></Field>
                <Field label="Description" htmlFor="ai-d"><Input id="ai-d" maxLength={300} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
                {add.isError && <ErrorState error={add.error} />}
                <Button type="submit" className="w-full" loading={add.isPending}>Add as pending</Button>
              </form>
            )}
          </Card>
          <Card title="Inputs" className="lg:col-span-2">
            {list.isLoading ? <Loading /> : list.isError ? <ErrorState error={list.error} /> : !list.data?.data.length ? <EmptyState title="No inputs for this period" /> : (
              <>
                {review.isError && <div className="mb-3"><ErrorState error={review.error} /></div>}
                <Table><thead><tr><Th>Employee</Th><Th>Type</Th><Th right>Value</Th><Th>Source</Th><Th>Status</Th><Th /></tr></thead>
                  <tbody>{list.data.data.map((i) => (
                    <tr key={i._id}><Td>{i.employeeId.firstName} {i.employeeId.lastName}<div className="text-xs text-slate-500">{i.employeeId.employeeCode}</div></Td><Td>{label(i.type)}{i.description && <div className="text-xs text-slate-500">{i.description}</div>}</Td>
                      <Td right>{i.type === 'unpaid_leave' ? `${i.value} d` : money(i.value)}</Td><Td>{label(i.source)}</Td><Td><Badge value={i.status} /></Td>
                      <Td>{i.status === 'pending' && !locked && i.enteredBy !== user!.id && <span className="flex gap-1"><Button variant="secondary" onClick={() => review.mutate({ id: i._id, decision: 'approved' })}>Approve</Button><Button variant="ghost" onClick={() => review.mutate({ id: i._id, decision: 'rejected' })}>Reject</Button></span>}</Td></tr>))}</tbody></Table>
                <Pagination page={list.data.meta.page} totalPages={list.data.meta.totalPages} total={list.data.meta.total} onPage={setPage} />
              </>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
