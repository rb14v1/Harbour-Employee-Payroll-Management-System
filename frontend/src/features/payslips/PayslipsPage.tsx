import { Download, Eye } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorState, Loading, Modal, PageHeader, Pagination, Table, Td, Th, errorMessage } from '@/components/ui';
import { useList } from '@/hooks/useApi';
import { api } from '@/lib/api';
import { money } from '@/lib/format';
import type { Payslip } from '@/types';
import { useAuth } from '@/features/auth/AuthContext';
import { can } from '@/lib/permissions';

export function PdfViewer({ id, onClose }: { id: string; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let revoked: string | null = null;
    api.blobUrl(`/payslips/${id}/pdf`).then((u) => { revoked = u; setUrl(u); }).catch((e) => setErr(errorMessage(e)));
    return () => { if (revoked) URL.revokeObjectURL(revoked); };
  }, [id]);
  return (
    <Modal open title="Payslip" onClose={onClose}>
      <div className="h-[70vh] w-full">{err ? <ErrorState error={new Error(err)} /> : !url ? <Loading text="Generating payslip…" /> : <iframe title="Payslip PDF" src={url} className="h-full w-full rounded border" />}</div>
      <div className="mt-3 flex justify-end"><Button variant="secondary" onClick={onClose}>Close</Button></div>
    </Modal>
  );
}

export function PayslipsPage() {
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const [view, setView] = useState<string | null>(null);
  const list = useList<Payslip>('/payslips', { page, limit: 12 });
  const all = can.seeAllPayslips(user!.role);
  return (
    <>
      <PageHeader title="Payslips" description={all ? 'Payslips from finalised payroll batches.' : 'Your payslips from finalised payroll.'} />
      <Card>
        {list.isLoading ? <Loading /> : list.isError ? <ErrorState error={list.error} /> : !list.data?.data.length ? <EmptyState title="No payslips yet" hint="Payslips appear once a payroll batch is finalised." /> : (
          <>
            <Table><thead><tr><Th>Period</Th>{all && <Th>Employee</Th>}<Th right>Gross</Th><Th right>Deductions</Th><Th right>Net pay</Th><Th /></tr></thead>
              <tbody>{list.data.data.map((s) => (
                <tr key={s._id}><Td>{s.periodName} {s.isDemo && <Badge tone="amber" value="sample" />}</Td>{all && <Td>{s.entryId?.snapshot.name}<div className="text-xs text-slate-500">{s.entryId?.snapshot.employeeCode}</div></Td>}
                  <Td right>{money(s.entryId?.grossEarnings)}</Td><Td right>{money(s.entryId?.totalEmployeeDeductions)}</Td><Td right>{money(s.entryId?.netPay)}</Td>
                  <Td><span className="flex justify-end gap-1"><Button variant="secondary" aria-label={`View ${s.periodName} payslip`} onClick={() => setView(s._id)}><Eye className="h-4 w-4" />View</Button>
                    <Button variant="secondary" aria-label={`Download ${s.periodName} payslip`} onClick={() => void api.download(`/payslips/${s._id}/pdf`, `payslip-${s.periodName.replace(/\s+/g, '-')}.pdf`)}><Download className="h-4 w-4" />PDF</Button></span></Td></tr>))}</tbody></Table>
            <Pagination page={list.data.meta.page} totalPages={list.data.meta.totalPages} total={list.data.meta.total} onPage={setPage} />
          </>
        )}
      </Card>
      {view && <PdfViewer id={view} onClose={() => setView(null)} />}
    </>
  );
}
