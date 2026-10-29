import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, Loading, Notice, PageHeader, Select, Table, Td, Textarea, Th } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthContext';
import { useAction } from '@/hooks/useApi';
import { api, type One } from '@/lib/api';
import { date, money, rupeesToPaise } from '@/lib/format';
import { can } from '@/lib/permissions';

interface Org { name: string; logoText?: string; currency: string; timezone: string; financialYearStartMonth: number; locations: { name: string; state: string }[]; settings: { segregationOfDuties: boolean; standardMonthDays: number; prorationBasis: 'calendar_days' | 'fixed_days' } }
interface Policy { _id: string; name: string; version: number; effectiveFrom: string; isTestOnly: boolean; pf?: { enabled: boolean; employeeRateBps?: number; employerRateBps?: number; wageCeilingPaise?: number }; esi?: { enabled: boolean }; tds?: { enabled: boolean }; professionalTax?: { enabled: boolean } }

export function SettingsPage() {
  const { user } = useAuth();
  return (
    <>
      <PageHeader title="Organisation settings" />
      {can.manageOrg(user!.role) && <OrgForm />}
      {can.managePolicy(user!.role) && <Policies />}
    </>
  );
}

function OrgForm() {
  const q = useQuery({ queryKey: ['org'], queryFn: async () => (await api.get<One<Org>>('/organization')).data });
  const [f, setF] = useState<Org | null>(null);
  const [locs, setLocs] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (q.data) { setF(q.data); setLocs(q.data.locations.map((l) => `${l.name}, ${l.state}`).join('\n')); } }, [q.data]);
  const save = useAction(() => api.patch('/organization', {
    name: f!.name, logoText: f!.logoText, timezone: f!.timezone, financialYearStartMonth: f!.financialYearStartMonth, settings: f!.settings,
    locations: locs.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [name, state] = l.split(',').map((s) => s.trim()); return { name: name ?? '', state: state ?? '' }; }),
  }), [['org']]);
  if (q.isLoading || !f) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} />;
  return (
    <Card title="Organisation profile and payroll settings" className="mb-6">
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={async (e) => { e.preventDefault(); setSaved(false); await save.mutateAsync(undefined); setSaved(true); }}>
        <Field label="Organisation name" htmlFor="o-n"><Input id="o-n" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Logo text (shown on payslips)" htmlFor="o-l"><Input id="o-l" value={f.logoText ?? ''} onChange={(e) => setF({ ...f, logoText: e.target.value })} /></Field>
        <Field label="Payroll currency" htmlFor="o-c" hint="Fixed to INR in this release"><Input id="o-c" value={f.currency} disabled /></Field>
        <Field label="Time zone" htmlFor="o-t"><Input id="o-t" value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })} /></Field>
        <Field label="Financial year starts in month" htmlFor="o-fy"><Select id="o-fy" value={f.financialYearStartMonth} onChange={(e) => setF({ ...f, financialYearStartMonth: Number(e.target.value) })}>{Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{new Date(2000, i).toLocaleString('en-GB', { month: 'long' })}</option>)}</Select></Field>
        <Field label="Proration basis" htmlFor="o-pb"><Select id="o-pb" value={f.settings.prorationBasis} onChange={(e) => setF({ ...f, settings: { ...f.settings, prorationBasis: e.target.value as Org['settings']['prorationBasis'] } })}><option value="calendar_days">Calendar days in month</option><option value="fixed_days">Fixed days per month</option></Select></Field>
        <Field label="Fixed days per month" htmlFor="o-d"><Input id="o-d" type="number" min={28} max={31} value={f.settings.standardMonthDays} onChange={(e) => setF({ ...f, settings: { ...f.settings, standardMonthDays: Number(e.target.value) } })} /></Field>
        <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" checked={f.settings.segregationOfDuties} onChange={(e) => setF({ ...f, settings: { ...f.settings, segregationOfDuties: e.target.checked } })} />Enforce segregation of duties (preparer cannot approve)</label>
        <div className="sm:col-span-2"><Field label="Office locations (one per line: name, state)" htmlFor="o-loc"><Textarea id="o-loc" rows={4} value={locs} onChange={(e) => setLocs(e.target.value)} /></Field></div>
        <div className="flex items-center gap-3 sm:col-span-2"><Button type="submit" loading={save.isPending}>Save settings</Button>{saved && <Notice tone="green">Saved.</Notice>}</div>
        {save.isError && <div className="sm:col-span-2"><ErrorState error={save.error} /></div>}
      </form>
    </Card>
  );
}

const SAMPLE_PT = '[{"state":"KA","slabs":[{"fromPaise":0,"toPaise":2499999,"amountPaise":0},{"fromPaise":2500000,"amountPaise":20000}]}]';
const SAMPLE_TDS = '[{"regime":"new","standardDeductionPaise":5000000,"cessBps":400,"slabs":[{"fromPaise":0,"toPaise":30000000,"rateBps":0},{"fromPaise":30000000,"rateBps":500}]}]';

function Policies() {
  const q = useQuery({ queryKey: ['policies'], queryFn: async () => (await api.get<One<Policy[]>>('/payroll-policies')).data });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', effectiveFrom: '', isTestOnly: true, pfOn: false, pfEe: '', pfEr: '', pfCeil: '', esiOn: false, esiEe: '', esiEr: '', esiThr: '', ptJson: '', tdsJson: '' });
  const [parseErr, setParseErr] = useState('');
  const create = useAction(() => {
    const parse = (s: string, label: string) => { if (!s.trim()) return undefined; try { return JSON.parse(s); } catch { throw new Error(`${label} is not valid JSON`); } };
    const pt = parse(f.ptJson, 'Professional tax rules');
    const tds = parse(f.tdsJson, 'TDS rules');
    const num = (s: string) => (s === '' ? undefined : Number(s));
    return api.post('/payroll-policies', {
      name: f.name, effectiveFrom: f.effectiveFrom, isTestOnly: f.isTestOnly,
      pf: { enabled: f.pfOn, employeeRateBps: num(f.pfEe), employerRateBps: num(f.pfEr), wageCeilingPaise: f.pfCeil ? rupeesToPaise(f.pfCeil) : undefined },
      esi: { enabled: f.esiOn, employeeRateBps: num(f.esiEe), employerRateBps: num(f.esiEr), grossThresholdPaise: f.esiThr ? rupeesToPaise(f.esiThr) : undefined },
      professionalTax: { enabled: Boolean(pt), states: pt ?? [] }, tds: { enabled: Boolean(tds), regimes: tds ?? [] },
    });
  }, [['policies']]);
  return (
    <Card title="Statutory and payroll policy versions" actions={<Button variant="secondary" onClick={() => setOpen(!open)}>{open ? 'Close' : 'New version'}</Button>}>
      <Notice tone="amber">Rates and slabs are configuration, not code. Versions are immutable and apply from their effective date. Values must be verified by a qualified payroll professional before use; this system does not certify statutory compliance.</Notice>
      {open && (
        <form className="mt-4 grid gap-4 sm:grid-cols-2" onSubmit={async (e) => { e.preventDefault(); setParseErr(''); try { await create.mutateAsync(undefined); setOpen(false); } catch (err) { if (err instanceof Error && /JSON/.test(err.message)) setParseErr(err.message); } }}>
          <Field label="Name" htmlFor="p-n"><Input id="p-n" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Effective from" htmlFor="p-e"><Input id="p-e" type="date" required value={f.effectiveFrom} onChange={(e) => setF({ ...f, effectiveFrom: e.target.value })} /></Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={f.isTestOnly} onChange={(e) => setF({ ...f, isTestOnly: e.target.checked })} />Mark as TEST-ONLY (illustrative values, not verified)</label>
          <fieldset className="space-y-2 sm:col-span-2"><legend className="text-sm font-medium">Provident Fund</legend>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.pfOn} onChange={(e) => setF({ ...f, pfOn: e.target.checked })} />Enabled</label>
            <div className="grid gap-3 sm:grid-cols-3"><Field label="Employee rate (bps)" htmlFor="pf1"><Input id="pf1" type="number" min={0} max={10000} value={f.pfEe} onChange={(e) => setF({ ...f, pfEe: e.target.value })} /></Field><Field label="Employer rate (bps)" htmlFor="pf2"><Input id="pf2" type="number" min={0} max={10000} value={f.pfEr} onChange={(e) => setF({ ...f, pfEr: e.target.value })} /></Field><Field label="Monthly wage ceiling (₹)" htmlFor="pf3"><Input id="pf3" inputMode="decimal" value={f.pfCeil} onChange={(e) => setF({ ...f, pfCeil: e.target.value })} /></Field></div></fieldset>
          <fieldset className="space-y-2 sm:col-span-2"><legend className="text-sm font-medium">ESI</legend>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.esiOn} onChange={(e) => setF({ ...f, esiOn: e.target.checked })} />Enabled</label>
            <div className="grid gap-3 sm:grid-cols-3"><Field label="Employee rate (bps)" htmlFor="es1"><Input id="es1" type="number" min={0} max={10000} value={f.esiEe} onChange={(e) => setF({ ...f, esiEe: e.target.value })} /></Field><Field label="Employer rate (bps)" htmlFor="es2"><Input id="es2" type="number" min={0} max={10000} value={f.esiEr} onChange={(e) => setF({ ...f, esiEr: e.target.value })} /></Field><Field label="Monthly gross threshold (₹)" htmlFor="es3"><Input id="es3" inputMode="decimal" value={f.esiThr} onChange={(e) => setF({ ...f, esiThr: e.target.value })} /></Field></div></fieldset>
          <Field label="Professional tax rules (JSON, amounts in paise)" htmlFor="p-pt" hint="Leave blank to disable"><Textarea id="p-pt" rows={5} placeholder={SAMPLE_PT} value={f.ptJson} onChange={(e) => setF({ ...f, ptJson: e.target.value })} /></Field>
          <Field label="TDS regimes (JSON, amounts in paise, rates in bps)" htmlFor="p-td" hint="Leave blank to disable"><Textarea id="p-td" rows={5} placeholder={SAMPLE_TDS} value={f.tdsJson} onChange={(e) => setF({ ...f, tdsJson: e.target.value })} /></Field>
          {(parseErr || create.isError) && <div className="sm:col-span-2"><ErrorState error={parseErr ? new Error(parseErr) : create.error} /></div>}
          <div className="sm:col-span-2"><Button type="submit" loading={create.isPending}>Create version</Button></div>
        </form>
      )}
      <div className="mt-4">
        {q.isLoading ? <Loading /> : q.isError ? <ErrorState error={q.error} /> : !q.data?.length ? <EmptyState title="No policy versions" hint="Without a policy, statutory deductions are skipped and flagged." /> : (
          <Table><thead><tr><Th>Version</Th><Th>Name</Th><Th>Effective from</Th><Th>PF</Th><Th>ESI</Th><Th>PT</Th><Th>TDS</Th><Th>Verified?</Th></tr></thead>
            <tbody>{q.data.map((p) => <tr key={p._id}><Td>v{p.version}</Td><Td>{p.name}</Td><Td>{date(p.effectiveFrom)}</Td><Td>{p.pf?.enabled ? `${(p.pf.employeeRateBps ?? 0) / 100}% / ${(p.pf.employerRateBps ?? 0) / 100}%, cap ${money(p.pf.wageCeilingPaise)}` : 'Off'}</Td><Td>{p.esi?.enabled ? 'On' : 'Off'}</Td><Td>{p.professionalTax?.enabled ? 'On' : 'Off'}</Td><Td>{p.tds?.enabled ? 'On' : 'Off'}</Td><Td>{p.isTestOnly ? <Badge tone="amber" value="Test-only" /> : <Badge tone="green" value="Declared verified" />}</Td></tr>)}</tbody></Table>
        )}
      </div>
    </Card>
  );
}
