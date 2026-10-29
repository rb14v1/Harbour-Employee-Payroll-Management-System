import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, Loading, Notice, PageHeader, Select, Table, Td, Th } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthContext';
import { useAction, useOne } from '@/hooks/useApi';
import { api, type One } from '@/lib/api';
import { date, label, money, paiseToRupeesInput, rupeesToPaise } from '@/lib/format';
import { can } from '@/lib/permissions';
import type { Component, SalaryStructure } from '@/types';
import { useQuery } from '@tanstack/react-query';

export function SalaryStructuresPage() {
  const { user } = useAuth();
  const list = useQuery({ queryKey: ['structures'], queryFn: async () => (await api.get<One<SalaryStructure[]>>('/salary-structures')).data });
  return (
    <>
      <PageHeader title="Salary structures" description="Reusable templates. Assigning one to an employee takes a snapshot, so later edits never change past payroll." actions={can.manageSalary(user!.role) && <Link to="/salary-structures/new"><Button><Plus className="h-4 w-4" />New structure</Button></Link>} />
      <Card>
        {list.isLoading ? <Loading /> : list.isError ? <ErrorState error={list.error} /> : !list.data?.length ? <EmptyState title="No salary structures" hint="Create one to start assigning salaries." /> : (
          <Table><thead><tr><Th>Name</Th><Th right>Annual CTC</Th><Th right>Monthly gross</Th><Th>Effective from</Th><Th>Version</Th><Th>Status</Th></tr></thead>
            <tbody>{list.data.map((s) => {
              const gross = s.components.filter((c) => c.type === 'earning').reduce((a, c) => a + c.annualAmount, 0);
              return <tr key={s._id}><Td><Link className="font-medium text-brand-700 hover:underline" to={`/salary-structures/${s._id}`}>{s.name}</Link></Td><Td right>{money(s.annualCtc)}</Td><Td right>{money(Math.round(gross / 12))}</Td><Td>{date(s.effectiveFrom)}</Td><Td>v{s.version}</Td><Td><Badge value={s.isActive ? 'active' : 'inactive'} /></Td></tr>;
            })}</tbody></Table>
        )}
      </Card>
    </>
  );
}

interface Row { code: string; name: string; type: Component['type']; amount: string; prorated: boolean; isBasic: boolean }
const blank = (): Row => ({ code: '', name: '', type: 'earning', amount: '0.00', prorated: true, isBasic: false });

export function SalaryStructureEditorPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const editable = can.manageSalary(user!.role);
  const existing = useOne<SalaryStructure>(`/salary-structures/${id}`, Boolean(id));
  const [name, setName] = useState('');
  const [ctc, setCtc] = useState('0.00');
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 10));
  const [rows, setRows] = useState<Row[]>([{ ...blank(), code: 'BASIC', name: 'Basic salary', isBasic: true }]);

  useEffect(() => {
    const s = existing.data;
    if (!s) return;
    setName(s.name);
    setCtc(paiseToRupeesInput(s.annualCtc));
    setFrom(s.effectiveFrom.slice(0, 10));
    setRows(s.components.map((c) => ({ code: c.code, name: c.name, type: c.type, amount: paiseToRupeesInput(c.annualAmount), prorated: c.prorated, isBasic: c.isBasic })));
  }, [existing.data]);

  const sum = (types: Component['type'][]) => rows.filter((r) => types.includes(r.type)).reduce((a, r) => a + rupeesToPaise(r.amount || 0), 0);
  const gross = sum(['earning']);
  const ctcParts = sum(['earning', 'employer_contribution', 'variable']);
  const ctcPaise = rupeesToPaise(ctc || 0);
  const reconciles = ctcParts === ctcPaise;

  const save = useAction(async () => {
    const body = { name, annualCtc: ctcPaise, effectiveFrom: from, components: rows.map((r) => ({ code: r.code, name: r.name, type: r.type, annualAmount: rupeesToPaise(r.amount || 0), prorated: r.prorated, isBasic: r.isBasic })) };
    return id ? api.patch<One<SalaryStructure>>(`/salary-structures/${id}`, body) : api.post<One<SalaryStructure>>('/salary-structures', body);
  }, [['structures'], [`/salary-structures/${id}`]]);

  if (id && existing.isLoading) return <Loading />;
  const set = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <>
      <PageHeader title={id ? `Salary structure: ${name}` : 'New salary structure'} description="Annual amounts in rupees. CTC = earnings + employer contributions + variable pay. Employee deductions are taken from gross and are not part of CTC." />
      <form className="space-y-4" onSubmit={async (e) => { e.preventDefault(); const r = await save.mutateAsync(undefined); nav(`/salary-structures/${r.data._id}`); }}>
        <Card title="Details">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Name" htmlFor="ss-n"><Input id="ss-n" required value={name} disabled={!editable} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Annual CTC (₹)" htmlFor="ss-c"><Input id="ss-c" inputMode="decimal" pattern="\d+(\.\d{1,2})?" required value={ctc} disabled={!editable} onChange={(e) => setCtc(e.target.value)} /></Field>
            <Field label="Effective from" htmlFor="ss-f"><Input id="ss-f" type="date" required value={from} disabled={!editable} onChange={(e) => setFrom(e.target.value)} /></Field>
          </div>
        </Card>
        <Card title="Components" actions={editable && <Button type="button" variant="secondary" onClick={() => setRows([...rows, blank()])}><Plus className="h-4 w-4" />Add component</Button>}>
          <Table>
            <thead><tr><Th>Code</Th><Th>Name</Th><Th>Type</Th><Th right>Annual (₹)</Th><Th>Prorated</Th><Th>Basic</Th><Th /></tr></thead>
            <tbody>{rows.map((r, i) => (
              <tr key={i}>
                <Td><Input aria-label="Code" required value={r.code} disabled={!editable} onChange={(e) => set(i, { code: e.target.value.toUpperCase() })} className="w-28" /></Td>
                <Td><Input aria-label="Name" required value={r.name} disabled={!editable} onChange={(e) => set(i, { name: e.target.value })} /></Td>
                <Td><Select aria-label="Type" value={r.type} disabled={!editable} onChange={(e) => set(i, { type: e.target.value as Row['type'] })}>{(['earning', 'employer_contribution', 'employee_deduction', 'variable'] as const).map((t) => <option key={t} value={t}>{label(t)}</option>)}</Select></Td>
                <Td right><Input aria-label="Annual amount" inputMode="decimal" required value={r.amount} disabled={!editable} onChange={(e) => set(i, { amount: e.target.value })} className="w-36 text-right" /></Td>
                <Td><input type="checkbox" aria-label="Prorated" checked={r.prorated} disabled={!editable} onChange={(e) => set(i, { prorated: e.target.checked })} /></Td>
                <Td><input type="checkbox" aria-label="Basic" checked={r.isBasic} disabled={!editable} onChange={(e) => set(i, { isBasic: e.target.checked })} /></Td>
                <Td>{editable && rows.length > 1 && <button type="button" aria-label="Remove component" onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4 text-slate-500" /></button>}</Td>
              </tr>))}</tbody>
          </Table>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div><dt className="text-xs text-slate-500">Annual gross earnings</dt><dd className="font-semibold">{money(gross)}</dd></div>
            <div><dt className="text-xs text-slate-500">Monthly gross</dt><dd className="font-semibold">{money(Math.round(gross / 12))}</dd></div>
            <div><dt className="text-xs text-slate-500">Components total (CTC basis)</dt><dd className="font-semibold">{money(ctcParts)}</dd></div>
            <div><dt className="text-xs text-slate-500">Declared CTC</dt><dd className="font-semibold">{money(ctcPaise)}</dd></div>
          </dl>
          <div className="mt-3">{reconciles ? <Notice tone="green">Components reconcile to the declared CTC.</Notice> : <Notice tone="amber">Components total differs from CTC by {money(Math.abs(ctcParts - ctcPaise))}. Saving is blocked until they match.</Notice>}</div>
        </Card>
        {save.isError && <ErrorState error={save.error} />}
        {editable && <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => nav('/salary-structures')}>Cancel</Button><Button type="submit" loading={save.isPending} disabled={!reconciles}>Save structure</Button></div>}
      </form>
    </>
  );
}
