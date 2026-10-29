import { Link } from 'react-router-dom';
import { Badge, Card, EmptyState, ErrorState, Loading, PageHeader, Table, Td, Th } from '@/components/ui';
import { useList } from '@/hooks/useApi';
import { date, money } from '@/lib/format';
import type { Period } from '@/types';

export function ApprovalsPage() {
  const pending = useList<Period>('/payroll/periods', { status: 'pending_approval', limit: 50 });
  const awaitingPay = useList<Period>('/payroll/periods', { status: 'payment_processing', limit: 50 });
  const awaitingRec = useList<Period>('/payroll/periods', { status: 'reconciliation_pending', limit: 50 });
  const block = (title: string, q: typeof pending) => (
    <Card title={title} className="mb-4">
      {q.isLoading ? <Loading /> : q.isError ? <ErrorState error={q.error} /> : !q.data?.data.length ? <EmptyState title="Nothing waiting" /> : (
        <Table><thead><tr><Th>Period</Th><Th>Dates</Th><Th right>Employees</Th><Th right>Net payable</Th><Th right>Exceptions</Th><Th>Status</Th></tr></thead>
          <tbody>{q.data.data.map((p) => <tr key={p._id}><Td><Link className="font-medium text-brand-700 hover:underline" to={`/payroll/${p._id}`}>{p.name}</Link></Td><Td>{date(p.startDate)} – {date(p.endDate)}</Td><Td right>{p.totals.payableCount}</Td><Td right>{money(p.totals.net)}</Td><Td right>{p.totals.exceptionCount}</Td><Td><Badge value={p.status} /></Td></tr>)}</tbody></Table>
      )}
    </Card>
  );
  return (
    <>
      <PageHeader title="Payroll approvals" description="Open a batch to review totals, exceptions and employee breakdowns before deciding." />
      {block('Pending approval', pending)}
      {block('Approved batches awaiting payment', awaitingPay)}
      {block('Awaiting reconciliation', awaitingRec)}
    </>
  );
}
