import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Badge, Card, EmptyState, ErrorState, Loading, PageHeader, Stat } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthContext';
import { useList } from '@/hooks/useApi';
import { api, type One } from '@/lib/api';
import { label, money } from '@/lib/format';
import { can } from '@/lib/permissions';
import type { Employee } from '@/types';

interface Dash { statusMix: { status: string; count: number }[]; pendingApprovals: { _id: string; name: string; totals: { net: number } }[]; openExceptions: number; headcount: number }
interface SummaryRow { period: string; headcount: number; grossPaise: number; netPaise: number; employerCostPaise: number; momChangePaise: number }
interface DeptRow { department: string; headcount: number; grossPaise: number; employerCostPaise: number }

export function DashboardPage() {
  const { user } = useAuth();
  const finance = can.viewReports(user!.role);
  const dash = useQuery({ queryKey: ['dash'], enabled: finance, queryFn: async () => (await api.get<One<Dash>>('/reports/dashboard')).data });
  const trend = useQuery({ queryKey: ['trend'], enabled: finance, queryFn: async () => (await api.get<One<SummaryRow[]>>('/reports/payroll-summary')).data });
  const depts = useQuery({ queryKey: ['dept-costs'], enabled: finance, queryFn: async () => (await api.get<One<DeptRow[]>>('/reports/department-costs')).data });
  const emp = useList<Employee>('/employees', { limit: 1 }, !finance);

  if (!finance) {
    return (
      <>
        <PageHeader title={`Welcome, ${user!.name.split(' ')[0]}`} description="Your role does not include payroll reports." />
        <div className="grid gap-3 sm:grid-cols-3"><Stat label="Employees in your scope" value={emp.data?.meta.total ?? '…'} /></div>
        <Card className="mt-4"><p className="text-sm text-slate-600">Use the navigation to manage the areas your role covers. <Link className="text-brand-700 underline" to="/my-pay">View my pay</Link></p></Card>
      </>
    );
  }
  if (dash.isLoading || trend.isLoading) return <Loading />;
  if (dash.isError) return <ErrorState error={dash.error} />;
  const d = dash.data!;
  const latest = trend.data?.[trend.data.length - 1];
  const chartData = (trend.data ?? []).map((r) => ({ period: r.period, cost: r.employerCostPaise / 100, net: r.netPaise / 100 }));
  const deptData = (depts.data ?? []).map((r) => ({ department: r.department, cost: r.employerCostPaise / 100 }));

  return (
    <>
      <PageHeader title="Finance dashboard" description="Figures cover approved and finalised payroll batches only." />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Headcount (active)" value={d.headcount} />
        <Stat label="Latest employer cost" value={money(latest?.employerCostPaise)} hint={latest?.period} />
        <Stat label="Latest net payable" value={money(latest?.netPaise)} hint={latest ? `Gross ${money(latest.grossPaise)}` : undefined} />
        <Stat label="Open exceptions" value={d.openExceptions} hint={`${d.pendingApprovals.length} batch(es) pending approval`} />
      </div>
      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card title="Month-over-month payroll cost">
          {chartData.length === 0 ? <EmptyState title="No approved payroll yet" /> : (
            <div className="h-64" role="img" aria-label="Monthly employer cost and net pay"><ResponsiveContainer width="100%" height="100%"><LineChart data={chartData}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="period" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} width={70} /><Tooltip formatter={(v) => money(Number(v) * 100)} /><Legend /><Line type="monotone" dataKey="cost" name="Employer cost" stroke="#1d5fd1" strokeWidth={2} /><Line type="monotone" dataKey="net" name="Net pay" stroke="#0f766e" strokeWidth={2} /></LineChart></ResponsiveContainer></div>
          )}
        </Card>
        <Card title="Department-wise employer cost">
          {deptData.length === 0 ? <EmptyState title="No data" /> : (
            <div className="h-64" role="img" aria-label="Employer cost by department"><ResponsiveContainer width="100%" height="100%"><BarChart data={deptData}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="department" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} width={70} /><Tooltip formatter={(v) => money(Number(v) * 100)} /><Bar dataKey="cost" name="Employer cost" fill="#1d5fd1" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></div>
          )}
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Payroll processing status">{d.statusMix.length === 0 ? <EmptyState title="No payroll batches" /> : <ul className="space-y-2 text-sm">{d.statusMix.map((s) => <li key={s.status} className="flex items-center justify-between"><Badge value={s.status} /><span className="tabular-nums">{s.count}</span></li>)}</ul>}</Card>
        <Card title="Pending approvals">{d.pendingApprovals.length === 0 ? <EmptyState title="Nothing waiting" /> : <ul className="space-y-2 text-sm">{d.pendingApprovals.map((p) => <li key={p._id} className="flex justify-between"><Link className="text-brand-700 hover:underline" to={`/payroll/${p._id}`}>{p.name}</Link><span className="tabular-nums">{money(p.totals.net)}</span></li>)}</ul>}</Card>
      </div>
      <p className="mt-4 text-xs text-slate-500">Status labels: {label('payment_processing')}, {label('reconciliation_pending')}.</p>
    </>
  );
}
