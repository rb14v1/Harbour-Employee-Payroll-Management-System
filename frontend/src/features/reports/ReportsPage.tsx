import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { Button, Card, EmptyState, ErrorState, Field, Input, Loading, PageHeader, Select, Table, Td, Th } from '@/components/ui';
import { useRefs } from '@/hooks/useApi';
import { api, type One } from '@/lib/api';
import { label, money } from '@/lib/format';

type Row = Record<string, string | number>;
const REPORTS = [
  { key: 'payroll-summary', title: 'Payroll summary' },
  { key: 'department-costs', title: 'Department costs' },
  { key: 'deductions', title: 'Deductions by category' },
  { key: 'headcount', title: 'Headcount' },
] as const;

const cell = (k: string, v: string | number) => (k.endsWith('Paise') ? money(Number(v)) : v);
const head = (k: string) => label(k.replace(/Paise$/, '').replace(/([A-Z])/g, ' $1').toLowerCase());

export function ReportsPage() {
  const depts = useRefs('departments');
  const [report, setReport] = useState<(typeof REPORTS)[number]['key']>('payroll-summary');
  const [fy, setFy] = useState('');
  const [departmentId, setDept] = useState('');
  const [location, setLocation] = useState('');
  const params = { fy: fy || undefined, departmentId: departmentId || undefined, location: location || undefined };
  const q = useQuery({ queryKey: ['report', report, params], queryFn: async () => (await api.get<One<Row[]>>(`/reports/${report}`, params)).data });
  const cols = q.data?.[0] ? Object.keys(q.data[0]) : [];
  const exportAs = (format: 'csv' | 'pdf') => void api.download(`/reports/${report}`, `${report}.${format}`, { ...params, format });

  return (
    <>
      <PageHeader title="Reports" description="Aggregated on the server from approved and finalised payroll. Exports are recorded in the audit log." actions={<>
        <Button variant="secondary" onClick={() => exportAs('csv')}><Download className="h-4 w-4" />CSV</Button>
        <Button variant="secondary" onClick={() => exportAs('pdf')}><Download className="h-4 w-4" />PDF</Button>
      </>} />
      <Card>
        <div className="mb-4 grid gap-3 sm:grid-cols-4">
          <Field label="Report" htmlFor="rp-r"><Select id="rp-r" value={report} onChange={(e) => setReport(e.target.value as typeof report)}>{REPORTS.map((r) => <option key={r.key} value={r.key}>{r.title}</option>)}</Select></Field>
          <Field label="Financial year (start year)" htmlFor="rp-fy"><Input id="rp-fy" type="number" min={2000} max={2100} placeholder="e.g. 2026 = Apr 2026 – Mar 2027" value={fy} onChange={(e) => setFy(e.target.value)} disabled={report === 'headcount'} /></Field>
          <Field label="Department" htmlFor="rp-d"><Select id="rp-d" value={departmentId} onChange={(e) => setDept(e.target.value)}><option value="">All</option>{depts.data?.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}</Select></Field>
          <Field label="Location" htmlFor="rp-l"><Input id="rp-l" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Bengaluru" /></Field>
        </div>
        {q.isLoading ? <Loading /> : q.isError ? <ErrorState error={q.error} retry={() => void q.refetch()} /> : !q.data?.length ? <EmptyState title="No data for these filters" hint="Reports include approved and finalised payroll batches only." /> : (
          <Table><thead><tr>{cols.map((c) => <Th key={c} right={c.endsWith('Paise') || typeof q.data![0]![c] === 'number'}>{head(c)}</Th>)}</tr></thead>
            <tbody>{q.data.map((r, i) => <tr key={i}>{cols.map((c) => <Td key={c} right={typeof r[c] === 'number'}>{cell(c, r[c]!)}</Td>)}</tr>)}</tbody></Table>
        )}
      </Card>
    </>
  );
}
