import { useState } from 'react';
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Loading, PageHeader, Pagination, Select, Table, Td, Th } from '@/components/ui';
import { useAction, useList } from '@/hooks/useApi';
import { api } from '@/lib/api';
import { date } from '@/lib/format';

interface Row { _id: string; subject: string; description: string; status: string; createdAt: string; employeeId: { employeeCode: string; firstName: string; lastName: string } }

export function RequestsPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('open');
  const list = useList<Row>('/correction-requests', { page, limit: 15, status: status || undefined });
  const [target, setTarget] = useState<{ row: Row; decision: 'approved' | 'rejected' | 'resolved' } | null>(null);
  const review = useAction((v: { id: string; status: string; reviewNote: string }) => api.patch(`/correction-requests/${v.id}`, { status: v.status, reviewNote: v.reviewNote }), [['/correction-requests']]);
  return (
    <>
      <PageHeader title="Correction requests" description="Requests raised by employees in your scope. Managers see their reporting line only." />
      <Card actions={<Select aria-label="Status filter" className="w-40" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">All</option><option value="open">Open</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="resolved">Resolved</option></Select>}>
        {list.isLoading ? <Loading /> : list.isError ? <ErrorState error={list.error} /> : !list.data?.data.length ? <EmptyState title="No requests" /> : (
          <>
            <Table><thead><tr><Th>Employee</Th><Th>Subject</Th><Th>Raised</Th><Th>Status</Th><Th /></tr></thead>
              <tbody>{list.data.data.map((r) => <tr key={r._id}><Td>{r.employeeId.firstName} {r.employeeId.lastName}<div className="text-xs text-slate-500">{r.employeeId.employeeCode}</div></Td><Td><strong>{r.subject}</strong><div className="max-w-md text-xs text-slate-600">{r.description}</div></Td><Td>{date(r.createdAt)}</Td><Td><Badge value={r.status} /></Td>
                <Td>{['open', 'approved'].includes(r.status) && <span className="flex gap-1">{r.status === 'open' && <><Button variant="secondary" onClick={() => setTarget({ row: r, decision: 'approved' })}>Approve</Button><Button variant="ghost" onClick={() => setTarget({ row: r, decision: 'rejected' })}>Reject</Button></>}{r.status === 'approved' && <Button variant="secondary" onClick={() => setTarget({ row: r, decision: 'resolved' })}>Mark resolved</Button>}</span>}</Td></tr>)}</tbody></Table>
            <Pagination page={list.data.meta.page} totalPages={list.data.meta.totalPages} total={list.data.meta.total} onPage={setPage} />
          </>
        )}
      </Card>
      {target && <ConfirmDialog open title={`${target.decision === 'approved' ? 'Approve' : target.decision === 'rejected' ? 'Reject' : 'Resolve'} request`} confirmLabel="Confirm" danger={target.decision === 'rejected'} withComment commentRequired commentLabel="Note to employee" loading={review.isPending} error={review.error} message={<p>{target.row.subject}</p>} onClose={() => { setTarget(null); review.reset(); }} onConfirm={async (note) => { await review.mutateAsync({ id: target.row._id, status: target.decision, reviewNote: note }); setTarget(null); }} />}
    </>
  );
}
