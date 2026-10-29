import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, Loading, Notice, PageHeader, Select, Stat, Table, Td, Textarea, Th } from '@/components/ui';
import { useAction, useList } from '@/hooks/useApi';
import { api, type One } from '@/lib/api';
import { date, label, money } from '@/lib/format';
import type { Component, Employee, Line } from '@/types';
import { PdfViewer } from './PayslipsPage';

interface Dashboard { netPayHistory: { period: string; net: number; gross: number; deductions: number; payslipId: string | null }[]; latest: { period: string; net: number; gross: number; earnings: Line[]; deductions: Line[]; payslipId: string | null } | null }
interface Annual { financialYear: number | null; availableYears: number[]; months: number; gross: number; deductions: number; net: number; deductionBreakdown: { code: string; name: string; total: number }[] }
interface Req { _id: string; subject: string; description: string; status: string; reviewNote?: string; createdAt: string }

export function MyPayPage() {
  const dash = useQuery({ queryKey: ['me', 'dashboard'], queryFn: async () => (await api.get<One<Dashboard>>('/me/dashboard')).data, retry: false });
  const profile = useQuery({ queryKey: ['me', 'profile'], queryFn: async () => (await api.get<One<{ employee: Employee; salary: { annualCtc: number; effectiveFrom: string; components: Component[] } | null }>>('/me/profile')).data, retry: false });
  const [fy, setFy] = useState<number | undefined>();
  const annual = useQuery({ queryKey: ['me', 'annual', fy], queryFn: async () => (await api.get<One<Annual>>('/me/annual-summary', { fy })).data, retry: false });
  const [view, setView] = useState<string | null>(null);

  if (dash.isLoading) return <Loading />;
  if (dash.isError) return <ErrorState error={dash.error} />;
  const d = dash.data!;
  const e = profile.data?.employee;
  return (
    <>
      <PageHeader title="My pay" description={e ? `${e.firstName} ${e.lastName} · ${e.employeeCode}` : undefined} />
      {!d.latest ? <Card><EmptyState title="No payslips yet" hint="Your first payslip appears once payroll is finalised." /></Card> : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <Stat label={`Net pay · ${d.latest.period}`} value={money(d.latest.net)} />
            <Stat label="Gross earnings" value={money(d.latest.gross)} />
            <div className="flex items-center rounded-lg border border-slate-200 bg-white p-4 shadow-sm">{d.latest.payslipId && <Button onClick={() => setView(d.latest!.payslipId!)}>View latest payslip</Button>}</div>
          </div>
          <div className="mb-4 grid gap-4 lg:grid-cols-2">
            <Card title="Net pay history">
              <div className="h-56" role="img" aria-label="Monthly net pay chart">
                <ResponsiveContainer width="100%" height="100%"><BarChart data={d.netPayHistory.map((h) => ({ ...h, rupees: h.net / 100 }))}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="period" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} width={60} /><Tooltip formatter={(v) => money(Number(v) * 100)} /><Bar dataKey="rupees" name="Net pay" fill="#1d5fd1" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer>
              </div>
            </Card>
            <Card title={`Latest breakdown · ${d.latest.period}`}>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><h3 className="mb-1 font-semibold">Earnings</h3>{d.latest.earnings.map((l, i) => <p key={i} className="flex justify-between"><span>{l.name}</span><span className="tabular-nums">{money(l.amount)}</span></p>)}</div>
                <div><h3 className="mb-1 font-semibold">Deductions</h3>{d.latest.deductions.length ? d.latest.deductions.map((l, i) => <p key={i} className="flex justify-between"><span>{l.name}</span><span className="tabular-nums">{money(l.amount)}</span></p>) : <p className="text-slate-500">None</p>}</div>
              </div>
            </Card>
          </div>
        </>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Annual summary" actions={annual.data && annual.data.availableYears.length > 0 && <Select aria-label="Financial year" value={annual.data.financialYear ?? ''} onChange={(e) => setFy(Number(e.target.value))} className="w-36">{annual.data.availableYears.map((y) => <option key={y} value={y}>FY {y}-{String(y + 1).slice(2)}</option>)}</Select>}>
          {annual.isLoading ? <Loading /> : !annual.data || annual.data.months === 0 ? <EmptyState title="No finalised months yet" /> : (
            <><dl className="grid grid-cols-3 gap-3 text-sm"><div><dt className="text-xs text-slate-500">Gross</dt><dd className="font-semibold">{money(annual.data.gross)}</dd></div><div><dt className="text-xs text-slate-500">Deductions</dt><dd className="font-semibold">{money(annual.data.deductions)}</dd></div><div><dt className="text-xs text-slate-500">Net</dt><dd className="font-semibold">{money(annual.data.net)}</dd></div></dl>
              <Table><thead><tr><Th>Deduction</Th><Th right>Total</Th></tr></thead><tbody>{annual.data.deductionBreakdown.map((b) => <tr key={b.code}><Td>{b.name}</Td><Td right>{money(b.total)}</Td></tr>)}</tbody></Table>
              <p className="mt-2 text-xs text-slate-500">Tax certificates (e.g. Form 16) are not generated by this system yet.</p></>
          )}
        </Card>
        <Card title="Profile and salary">
          {profile.isLoading ? <Loading /> : profile.isError ? <ErrorState error={profile.error} /> : e && (
            <><dl className="grid grid-cols-2 gap-3 text-sm">{[['Department', e.departmentId?.name], ['Designation', e.designationId?.title], ['Joined', date(e.joiningDate)], ['Work email', e.workEmail]].map(([k, v]) => <div key={k}><dt className="text-xs text-slate-500">{k}</dt><dd className="font-medium">{v}</dd></div>)}</dl>
              {profile.data?.salary ? <><p className="mt-4 text-sm">Annual CTC <strong>{money(profile.data.salary.annualCtc)}</strong> <span className="text-xs text-slate-500">(not the same as take-home)</span></p>
                <Table><thead><tr><Th>Component</Th><Th>Type</Th><Th right>Annual</Th></tr></thead><tbody>{profile.data.salary.components.map((c) => <tr key={c.code}><Td>{c.name}</Td><Td>{label(c.type)}</Td><Td right>{money(c.annualAmount)}</Td></tr>)}</tbody></Table></> : <p className="mt-3 text-sm text-slate-500">No salary assigned yet.</p>}</>
          )}
        </Card>
      </div>
      <CorrectionRequests />
      {view && <PdfViewer id={view} onClose={() => setView(null)} />}
    </>
  );
}

const reqSchema = z.object({ subject: z.string().min(3, 'At least 3 characters').max(150), description: z.string().min(10, 'Please give at least 10 characters of detail').max(2000) });

function CorrectionRequests() {
  const list = useList<Req>('/me/correction-requests', { limit: 20 });
  const [done, setDone] = useState(false);
  const { register, handleSubmit, reset, formState: { errors } } = useForm<z.infer<typeof reqSchema>>({ resolver: zodResolver(reqSchema) });
  const create = useAction((v: z.infer<typeof reqSchema>) => api.post('/me/correction-requests', v), [['/me/correction-requests']]);
  return (
    <Card title="Payroll correction requests" className="mt-4">
      <div className="grid gap-6 lg:grid-cols-2">
        <form noValidate className="space-y-3" onSubmit={handleSubmit(async (v) => { setDone(false); await create.mutateAsync(v); reset(); setDone(true); })}>
          <Field label="Subject" htmlFor="cr-s" error={errors.subject?.message}><Input id="cr-s" {...register('subject')} /></Field>
          <Field label="What needs correcting?" htmlFor="cr-d" error={errors.description?.message}><Textarea id="cr-d" {...register('description')} /></Field>
          {create.isError && <ErrorState error={create.error} />}
          {done && <Notice tone="green">Request submitted.</Notice>}
          <Button type="submit" loading={create.isPending}>Submit request</Button>
        </form>
        <div>
          {list.isLoading ? <Loading /> : !list.data?.data.length ? <EmptyState title="No requests yet" /> : (
            <ul className="space-y-3 text-sm">{list.data.data.map((r) => <li key={r._id} className="rounded border border-slate-200 p-3"><div className="flex items-center justify-between"><strong>{r.subject}</strong><Badge value={r.status} /></div><p className="mt-1 text-slate-600">{r.description}</p>{r.reviewNote && <p className="mt-1 text-xs text-slate-500">Response: {r.reviewNote}</p>}<p className="mt-1 text-xs text-slate-400">{date(r.createdAt)}</p></li>)}</ul>
          )}
        </div>
      </div>
    </Card>
  );
}
