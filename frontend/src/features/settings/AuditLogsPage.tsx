import { useState } from 'react';
import { Card, EmptyState, ErrorState, Field, Input, Loading, PageHeader, Pagination, Table, Td, Th } from '@/components/ui';
import { useList } from '@/hooks/useApi';
import { dateTime } from '@/lib/format';

interface Log { _id: string; action: string; entityType?: string; entityId?: string; actorRole?: string; actorId?: { name: string; email: string } | null; summary?: unknown; createdAt: string }

export function AuditLogsPage() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const list = useList<Log>('/audit-logs', { page, limit: 25, action: action || undefined, from: from || undefined });
  return (
    <>
      <PageHeader title="Audit logs" description="Append-only record of significant actions. Sensitive values are redacted before storage." />
      <Card>
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <Field label="Action starts with" htmlFor="al-a"><Input id="al-a" placeholder="e.g. payroll." value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} /></Field>
          <Field label="From date" htmlFor="al-f"><Input id="al-f" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} /></Field>
        </div>
        {list.isLoading ? <Loading /> : list.isError ? <ErrorState error={list.error} /> : !list.data?.data.length ? <EmptyState title="No audit events match" /> : (
          <>
            <Table><thead><tr><Th>When</Th><Th>Actor</Th><Th>Action</Th><Th>Record</Th><Th>Summary</Th></tr></thead>
              <tbody>{list.data.data.map((l) => <tr key={l._id}><Td className="whitespace-nowrap">{dateTime(l.createdAt)}</Td><Td>{l.actorId?.name ?? 'System'}<div className="text-xs text-slate-500">{l.actorRole}</div></Td><Td><code className="text-xs">{l.action}</code></Td><Td>{l.entityType}<div className="text-xs text-slate-500">{l.entityId}</div></Td><Td><code className="block max-w-xs truncate text-xs text-slate-600" title={JSON.stringify(l.summary)}>{l.summary ? JSON.stringify(l.summary) : ''}</code></Td></tr>)}</tbody></Table>
            <Pagination page={list.data.meta.page} totalPages={list.data.meta.totalPages} total={list.data.meta.total} onPage={setPage} />
          </>
        )}
      </Card>
    </>
  );
}
