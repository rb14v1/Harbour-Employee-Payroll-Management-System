import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { Download, Plus, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, Input, Loading, Modal, Notice, PageHeader, Pagination, Select, Table, Td, Th } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthContext';
import { useAction, useList, useOne, useRefs } from '@/hooks/useApi';
import { api, type One } from '@/lib/api';
import { date, label, money } from '@/lib/format';
import { can } from '@/lib/permissions';
import type { Component, Employee, SalaryStructure } from '@/types';

export function EmployeesPage() {
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [departmentId, setDept] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState<{ key: string; order: 'asc' | 'desc' }>({ key: 'employeeCode', order: 'asc' });
  const [importResult, setImportResult] = useState<{ created: number; failed: number; errors: { row: number; message: string }[] } | null>(null);
  const [importError, setImportError] = useState<unknown>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const depts = useRefs('departments');
  const list = useList<Employee>('/employees', { page, limit: 15, q: q || undefined, departmentId: departmentId || undefined, status: status || undefined, sort: sort.key, order: sort.order });
  const importer = useAction((f: File) => api.upload<One<{ created: number; failed: number; errors: { row: number; message: string }[] }>>('/employees/import', f), [['/employees']]);
  const sortBy = (key: string) => setSort((s) => ({ key, order: s.key === key && s.order === 'asc' ? 'desc' : 'asc' }));
  const sorted = (k: string) => (sort.key === k ? sort.order : null);

  return (
    <>
      <PageHeader title="Employees" description={user!.role === 'manager' ? 'Employees in your reporting line' : undefined} actions={<>
        {can.manageEmployees(user!.role) && <>
          <input ref={fileRef} type="file" accept=".csv" hidden aria-label="Import employees CSV" onChange={async (e) => {
            const f = e.target.files?.[0]; e.target.value = '';
            if (!f) return;
            setImportError(null); setImportResult(null);
            try { setImportResult((await importer.mutateAsync(f)).data); } catch (err) { setImportError(err); }
          }} />
          <Button variant="secondary" onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4" />Import CSV</Button>
          <Link to="/employees/new"><Button><Plus className="h-4 w-4" />New employee</Button></Link>
        </>}
        {user!.role !== 'employee' && <Button variant="secondary" onClick={() => void api.download('/employees/export', 'employees.csv', { q, departmentId, status })}><Download className="h-4 w-4" />Export</Button>}
      </>} />
      {importError ? <div className="mb-4"><ErrorState error={importError} /></div> : null}
      {importResult && <div className="mb-4 space-y-2"><Notice tone={importResult.failed ? 'amber' : 'green'}>Imported {importResult.created} employee(s); {importResult.failed} row(s) failed.</Notice>
        {importResult.errors.length > 0 && <ul className="list-disc pl-6 text-sm text-red-800">{importResult.errors.map((e) => <li key={e.row}>Row {e.row}: {e.message}</li>)}</ul>}</div>}
      <Card>
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <Field label="Search" htmlFor="emp-q"><Input id="emp-q" placeholder="Name, ID or email" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></Field>
          <Field label="Department" htmlFor="emp-dept"><Select id="emp-dept" value={departmentId} onChange={(e) => { setDept(e.target.value); setPage(1); }}><option value="">All</option>{depts.data?.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}</Select></Field>
          <Field label="Status" htmlFor="emp-status"><Select id="emp-status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">All</option><option value="active">Active</option><option value="on_notice">On notice</option><option value="inactive">Inactive</option></Select></Field>
        </div>
        {list.isLoading ? <Loading /> : list.isError ? <ErrorState error={list.error} retry={() => void list.refetch()} /> : list.data!.data.length === 0 ? <EmptyState title="No employees match" hint="Adjust the filters or add an employee." /> : (
          <>
            <Table>
              <thead><tr><Th onClick={() => sortBy('employeeCode')} sorted={sorted('employeeCode')}>ID</Th><Th onClick={() => sortBy('firstName')} sorted={sorted('firstName')}>Name</Th><Th>Department</Th><Th>Designation</Th><Th onClick={() => sortBy('joiningDate')} sorted={sorted('joiningDate')}>Joined</Th><Th>Status</Th></tr></thead>
              <tbody>{list.data!.data.map((e) => (
                <tr key={e._id} className="hover:bg-slate-50">
                  <Td>{e.employeeCode}</Td><Td><Link className="font-medium text-brand-700 hover:underline" to={`/employees/${e._id}`}>{e.firstName} {e.lastName}</Link><div className="text-xs text-slate-500">{e.workEmail}</div></Td>
                  <Td>{e.departmentId?.name}</Td><Td>{e.designationId?.title}</Td><Td>{date(e.joiningDate)}</Td><Td><Badge value={e.status} /></Td>
                </tr>))}</tbody>
            </Table>
            <Pagination page={list.data!.meta.page} totalPages={list.data!.meta.totalPages} total={list.data!.meta.total} onPage={setPage} />
          </>
        )}
      </Card>
    </>
  );
}

interface RevisionRow { _id: string; effectiveFrom: string; annualCtc: number; isOverride: boolean; reason: string; components: Component[] }

export function EmployeeDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const role = user!.role;
  const emp = useOne<Employee>(`/employees/${id}`);
  const revisions = useQuery({ queryKey: ['revisions', id], enabled: can.viewSalary(role), queryFn: async () => (await api.get<One<RevisionRow[]>>(`/employees/${id}/salary-revisions`)).data });
  const history = useQuery({ queryKey: ['history', id], enabled: can.viewPayroll(role) || user!.employeeId === id, queryFn: async () => (await api.get<One<{ id: string; period: { name: string }; grossEarnings: number; totalEmployeeDeductions: number; netPay: number }[]>>(`/employees/${id}/payroll-history`)).data });
  const [assign, setAssign] = useState(false);
  const [deactivate, setDeactivate] = useState(false);
  const deact = useAction((b: { exitDate: string; reason: string }) => api.post(`/employees/${id}/deactivate`, b), [[`/employees/${id}`], ['/employees']]);

  if (emp.isLoading) return <Loading />;
  if (emp.isError) return <ErrorState error={emp.error} />;
  const e = emp.data!;
  return (
    <>
      <PageHeader title={`${e.firstName} ${e.lastName}`} description={`${e.employeeCode} · ${e.designationId?.title} · ${e.departmentId?.name}`} actions={<>
        {can.manageEmployees(role) && <Link to={`/employees/${id}/edit`}><Button variant="secondary">Edit</Button></Link>}
        {can.manageSalary(role) && <Button variant="secondary" onClick={() => setAssign(true)}>Assign salary</Button>}
        {can.manageEmployees(role) && e.status !== 'inactive' && <Button variant="danger" onClick={() => setDeactivate(true)}>Deactivate</Button>}
      </>} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Profile"><dl className="grid grid-cols-2 gap-3 text-sm">
          {[['Work email', e.workEmail], ['Status', label(e.status)], ['Employment type', label(e.employmentType)], ['Location', e.workLocation], ['Joined', date(e.joiningDate)], ['Exit date', e.exitDate ? date(e.exitDate) : '-'], ['Manager', e.managerId ? `${e.managerId.firstName} ${e.managerId.lastName}` : '-'], ['Tax regime', label(e.statutory.taxRegime)]].map(([k, v]) => <div key={k}><dt className="text-xs text-slate-500">{k}</dt><dd className="font-medium">{v}</dd></div>)}
        </dl></Card>
        <Card title="Statutory applicability"><div className="flex flex-wrap gap-2 text-sm">
          {([['PF', e.statutory.pfApplicable], ['ESI', e.statutory.esiApplicable], ['Professional tax', e.statutory.ptApplicable]] as const).map(([k, v]) => <Badge key={k} tone={v ? 'green' : 'slate'} value={`${k}: ${v ? 'applies' : 'n/a'}`} />)}
          {e.statutory.ptState && <Badge tone="blue" value={`PT state: ${e.statutory.ptState}`} />}</div>
          {e.bank && <dl className="mt-4 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-xs text-slate-500">Bank account</dt><dd className="font-medium">{e.bank.accountNumberMasked ?? '-'}</dd></div><div><dt className="text-xs text-slate-500">IFSC</dt><dd className="font-medium">{e.bank.ifsc ?? '-'}</dd></div><div><dt className="text-xs text-slate-500">PAN</dt><dd className="font-medium">{e.panMasked ?? '-'}</dd></div></dl>}
        </Card>
        {can.viewSalary(role) && <Card title="Salary revisions" className="lg:col-span-2">
          {revisions.isLoading ? <Loading /> : revisions.isError ? <ErrorState error={revisions.error} /> : !revisions.data?.length ? <EmptyState title="No salary assigned" hint="Assign a salary structure so this employee can be paid." /> : (
            <Table><thead><tr><Th>Effective from</Th><Th right>Annual CTC</Th><Th>Type</Th><Th>Reason</Th></tr></thead>
              <tbody>{revisions.data.map((r) => <tr key={r._id}><Td>{date(r.effectiveFrom)}</Td><Td right>{money(r.annualCtc)}</Td><Td>{r.isOverride ? 'Override' : 'Structure'}</Td><Td>{r.reason}</Td></tr>)}</tbody></Table>)}
        </Card>}
        {history.data && <Card title="Payroll history" className="lg:col-span-2">
          {history.data.length === 0 ? <EmptyState title="No finalised payroll yet" /> : <Table><thead><tr><Th>Period</Th><Th right>Gross</Th><Th right>Deductions</Th><Th right>Net</Th></tr></thead>
            <tbody>{history.data.map((h) => <tr key={h.id}><Td>{h.period?.name}</Td><Td right>{money(h.grossEarnings)}</Td><Td right>{money(h.totalEmployeeDeductions)}</Td><Td right>{money(h.netPay)}</Td></tr>)}</tbody></Table>}
        </Card>}
      </div>
      {assign && <AssignSalary employeeId={id!} onClose={() => setAssign(false)} />}
      <DeactivateDialog open={deactivate} loading={deact.isPending} error={deact.error} onClose={() => setDeactivate(false)} onConfirm={async (reason, exitDate) => { await deact.mutateAsync({ reason, exitDate }); setDeactivate(false); }} />
    </>
  );
}

function DeactivateDialog({ open, onClose, onConfirm, loading, error }: { open: boolean; onClose: () => void; onConfirm: (reason: string, exitDate: string) => Promise<void>; loading: boolean; error: unknown }) {
  const [exitDate, setExit] = useState(new Date().toISOString().slice(0, 10));
  return <ConfirmDialog open={open} title="Deactivate employee" danger confirmLabel="Deactivate" withComment commentRequired commentLabel="Reason" loading={loading} error={error} onClose={onClose}
    message={<><p>The employee is excluded from payroll periods after the exit date. This cannot be undone from the UI.</p><div className="mt-3"><Field label="Exit date" htmlFor="exit"><Input id="exit" type="date" value={exitDate} onChange={(e) => setExit(e.target.value)} /></Field></div></>}
    onConfirm={(reason) => void onConfirm(reason, exitDate)} />;
}

function AssignSalary({ employeeId, onClose }: { employeeId: string; onClose: () => void }) {
  const structures = useQuery({ queryKey: ['structures'], queryFn: async () => (await api.get<One<SalaryStructure[]>>('/salary-structures')).data });
  const [structureId, setStructureId] = useState('');
  const [effectiveFrom, setFrom] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState('');
  const create = useAction(() => api.post(`/employees/${employeeId}/salary-revisions`, { structureId, effectiveFrom, reason }), [['revisions', employeeId]]);
  return (
    <Modal open title="Assign salary structure" onClose={onClose}>
      <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); await create.mutateAsync(undefined); onClose(); }}>
        <Field label="Salary structure" htmlFor="as-s"><Select id="as-s" required value={structureId} onChange={(e) => setStructureId(e.target.value)}><option value="">Select…</option>{structures.data?.filter((s) => s.isActive).map((s) => <option key={s._id} value={s._id}>{s.name} ({money(s.annualCtc)} CTC)</option>)}</Select></Field>
        <Field label="Effective from" htmlFor="as-d"><Input id="as-d" type="date" required value={effectiveFrom} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="Reason" htmlFor="as-r"><Input id="as-r" required minLength={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        {create.isError && <ErrorState error={create.error} />}
        <div className="flex justify-end gap-2"><Button variant="secondary" type="button" onClick={onClose}>Cancel</Button><Button type="submit" loading={create.isPending}>Assign</Button></div>
      </form>
    </Modal>
  );
}

const formSchema = z.object({
  firstName: z.string().min(1, 'Required').max(100), lastName: z.string().min(1, 'Required').max(100), workEmail: z.string().email('Enter a valid email'),
  departmentId: z.string().min(1, 'Select a department'), designationId: z.string().min(1, 'Select a designation'), managerId: z.string().optional(),
  joiningDate: z.string().min(1, 'Required'), employmentType: z.enum(['full_time', 'part_time', 'contract', 'intern']), workLocation: z.string().min(1, 'Required'),
  taxRegime: z.enum(['old', 'new']), pfApplicable: z.boolean(), esiApplicable: z.boolean(), ptApplicable: z.boolean(), ptState: z.string().optional(),
  accountHolder: z.string().optional(), accountNumber: z.string().regex(/^(\d{6,20})?$/, '6-20 digits').optional(), ifsc: z.string().regex(/^([A-Za-z]{4}0[A-Za-z0-9]{6})?$/, 'Invalid IFSC').optional(),
  panNumber: z.string().regex(/^([A-Za-z]{5}\d{4}[A-Za-z])?$/, 'Invalid PAN').optional(),
});
type FormValues = z.infer<typeof formSchema>;

export function EmployeeFormPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const editing = Boolean(id);
  const existing = useOne<Employee>(`/employees/${id}`, editing);
  const depts = useRefs('departments');
  const desigs = useRefs('designations');
  const managers = useList<Employee>('/employees', { limit: 100 });
  const [error, setError] = useState<unknown>(null);
  const defaults: FormValues = { firstName: '', lastName: '', workEmail: '', departmentId: '', designationId: '', managerId: '', joiningDate: '', employmentType: 'full_time', workLocation: '', taxRegime: 'new', pfApplicable: false, esiApplicable: false, ptApplicable: false, ptState: '' };
  const e = existing.data;
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    values: e ? { ...defaults, firstName: e.firstName, lastName: e.lastName, workEmail: e.workEmail, departmentId: e.departmentId._id, designationId: e.designationId._id, managerId: e.managerId?._id ?? '', joiningDate: e.joiningDate.slice(0, 10), employmentType: e.employmentType as FormValues['employmentType'], workLocation: e.workLocation, ...e.statutory, ptState: e.statutory.ptState ?? '' } : defaults,
  });
  const { register, handleSubmit, formState: { errors, isSubmitting } } = form;

  if (editing && existing.isLoading) return <Loading />;
  const submit = handleSubmit(async (v) => {
    setError(null);
    const { taxRegime, pfApplicable, esiApplicable, ptApplicable, ptState, accountHolder, accountNumber, ifsc, panNumber, managerId, ...base } = v;
    const body = { ...base, managerId: managerId || null, statutory: { taxRegime, pfApplicable, esiApplicable, ptApplicable, ptState: ptState || undefined }, ...(accountNumber && ifsc ? { bank: { accountHolder: accountHolder || `${v.firstName} ${v.lastName}`, accountNumber, ifsc } } : {}), ...(panNumber ? { panNumber } : {}) };
    try {
      const r = editing ? await api.patch<One<Employee>>(`/employees/${id}`, body) : await api.post<One<Employee>>('/employees', body);
      nav(`/employees/${r.data._id}`);
    } catch (err) { setError(err); }
  });

  return (
    <>
      <PageHeader title={editing ? 'Edit employee' : 'New employee'} description={editing ? undefined : 'The employee ID is generated by the system.'} />
      <form onSubmit={submit} noValidate className="space-y-4">
        {error ? <ErrorState error={error} /> : null}
        <Card title="Employment">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name" htmlFor="fn" error={errors.firstName?.message}><Input id="fn" {...register('firstName')} /></Field>
            <Field label="Last name" htmlFor="ln" error={errors.lastName?.message}><Input id="ln" {...register('lastName')} /></Field>
            <Field label="Work email" htmlFor="we" error={errors.workEmail?.message}><Input id="we" type="email" {...register('workEmail')} /></Field>
            <Field label="Joining date" htmlFor="jd" error={errors.joiningDate?.message}><Input id="jd" type="date" {...register('joiningDate')} /></Field>
            <Field label="Department" htmlFor="dp" error={errors.departmentId?.message}><Select id="dp" {...register('departmentId')}><option value="">Select…</option>{depts.data?.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}</Select></Field>
            <Field label="Designation" htmlFor="ds" error={errors.designationId?.message}><Select id="ds" {...register('designationId')}><option value="">Select…</option>{desigs.data?.map((d) => <option key={d._id} value={d._id}>{d.title}</option>)}</Select></Field>
            <Field label="Manager" htmlFor="mg"><Select id="mg" {...register('managerId')}><option value="">None</option>{managers.data?.data.filter((m) => m._id !== id).map((m) => <option key={m._id} value={m._id}>{m.firstName} {m.lastName} ({m.employeeCode})</option>)}</Select></Field>
            <Field label="Employment type" htmlFor="et"><Select id="et" {...register('employmentType')}><option value="full_time">Full time</option><option value="part_time">Part time</option><option value="contract">Contract</option><option value="intern">Intern</option></Select></Field>
            <Field label="Work location" htmlFor="wl" error={errors.workLocation?.message}><Input id="wl" {...register('workLocation')} /></Field>
          </div>
        </Card>
        <Card title="Statutory applicability">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Tax regime" htmlFor="tr"><Select id="tr" {...register('taxRegime')}><option value="new">New regime</option><option value="old">Old regime</option></Select></Field>
            <Field label="Professional tax state" htmlFor="pts" hint="Required when professional tax applies"><Input id="pts" placeholder="e.g. KA" {...register('ptState')} /></Field>
            {([['pfApplicable', 'Provident Fund applies'], ['esiApplicable', 'ESI applies'], ['ptApplicable', 'Professional tax applies']] as const).map(([k, l]) => <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" {...register(k)} />{l}</label>)}
          </div>
        </Card>
        <Card title="Bank and tax identifiers">
          <p className="mb-3 text-xs text-slate-500">Shown masked and never included in lists, exports or logs. Leave blank to keep existing values.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Account holder" htmlFor="ah"><Input id="ah" {...register('accountHolder')} /></Field>
            <Field label="Account number" htmlFor="an" error={errors.accountNumber?.message}><Input id="an" inputMode="numeric" autoComplete="off" {...register('accountNumber')} /></Field>
            <Field label="IFSC" htmlFor="if" error={errors.ifsc?.message}><Input id="if" autoComplete="off" {...register('ifsc')} /></Field>
            <Field label="PAN" htmlFor="pan" error={errors.panNumber?.message}><Input id="pan" autoComplete="off" {...register('panNumber')} /></Field>
          </div>
        </Card>
        <div className="flex justify-end gap-2"><Button variant="secondary" type="button" onClick={() => nav(-1)}>Cancel</Button><Button type="submit" loading={isSubmitting}>{editing ? 'Save changes' : 'Create employee'}</Button></div>
      </form>
    </>
  );
}
