import { useState } from 'react';
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, Input, Loading, Modal, PageHeader, Pagination, Select, Table, Td, Th } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthContext';
import { useAction, useList } from '@/hooks/useApi';
import { api } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { ROLE_LABELS, type Role } from '@/lib/permissions';
import type { Employee } from '@/types';

interface U { id: string; name: string; email: string; role: Role; isActive: boolean; lastLoginAt?: string; employeeId?: string }

export function UsersPage() {
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const list = useList<U>('/users', { page, limit: 15 });
  const employees = useList<Employee>('/employees', { limit: 100 });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', email: '', role: 'employee' as Role, password: '', employeeId: '' });
  const [toggle, setToggle] = useState<U | null>(null);
  const create = useAction(() => api.post('/users', { ...f, employeeId: f.employeeId || undefined }), [['/users']]);
  const patch = useAction((v: { id: string; body: object }) => api.patch(`/users/${v.id}`, v.body), [['/users']]);
  return (
    <>
      <PageHeader title="User management" description="Role changes and deactivation revoke the user's active sessions immediately." actions={<Button onClick={() => setOpen(true)}>New user</Button>} />
      <Card>
        {list.isLoading ? <Loading /> : list.isError ? <ErrorState error={list.error} /> : !list.data?.data.length ? <EmptyState title="No users" /> : (
          <>
            {patch.isError && <div className="mb-3"><ErrorState error={patch.error} /></div>}
            <Table><thead><tr><Th>Name</Th><Th>Role</Th><Th>Last sign-in</Th><Th>Status</Th><Th /></tr></thead>
              <tbody>{list.data.data.map((u) => (
                <tr key={u.id}><Td>{u.name}<div className="text-xs text-slate-500">{u.email}</div></Td>
                  <Td><Select aria-label={`Role for ${u.name}`} className="w-52" value={u.role} disabled={u.id === user!.id} onChange={(e) => patch.mutate({ id: u.id, body: { role: e.target.value } })}>{(Object.keys(ROLE_LABELS) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</Select></Td>
                  <Td>{dateTime(u.lastLoginAt)}</Td><Td><Badge value={u.isActive ? 'active' : 'inactive'} /></Td>
                  <Td>{u.id !== user!.id && <Button variant={u.isActive ? 'ghost' : 'secondary'} onClick={() => setToggle(u)}>{u.isActive ? 'Deactivate' : 'Activate'}</Button>}</Td></tr>))}</tbody></Table>
            <Pagination page={list.data.meta.page} totalPages={list.data.meta.totalPages} total={list.data.meta.total} onPage={setPage} />
          </>
        )}
      </Card>
      <Modal open={open} title="New user" onClose={() => { setOpen(false); create.reset(); }}>
        <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); await create.mutateAsync(undefined); setOpen(false); setF({ name: '', email: '', role: 'employee', password: '', employeeId: '' }); }}>
          <Field label="Name" htmlFor="u-n"><Input id="u-n" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Email" htmlFor="u-e"><Input id="u-e" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Role" htmlFor="u-r"><Select id="u-r" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>{(Object.keys(ROLE_LABELS) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</Select></Field>
          <Field label="Linked employee record" htmlFor="u-emp" hint="Required for the Employee role; lets staff see their own payslips"><Select id="u-emp" value={f.employeeId} onChange={(e) => setF({ ...f, employeeId: e.target.value })}><option value="">None</option>{employees.data?.data.map((e) => <option key={e._id} value={e._id}>{e.employeeCode} · {e.firstName} {e.lastName}</option>)}</Select></Field>
          <Field label="Initial password" htmlFor="u-p" hint="12+ characters with upper case, lower case and a digit"><Input id="u-p" type="password" autoComplete="new-password" required minLength={12} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
          {create.isError && <ErrorState error={create.error} />}
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" loading={create.isPending}>Create user</Button></div>
        </form>
      </Modal>
      {toggle && <ConfirmDialog open title={`${toggle.isActive ? 'Deactivate' : 'Activate'} ${toggle.name}`} confirmLabel={toggle.isActive ? 'Deactivate' : 'Activate'} danger={toggle.isActive} message={toggle.isActive ? 'The user is signed out everywhere and cannot sign in.' : 'The user can sign in again.'} loading={patch.isPending} onClose={() => setToggle(null)} onConfirm={async () => { await patch.mutateAsync({ id: toggle.id, body: { isActive: !toggle.isActive } }); setToggle(null); }} />}
    </>
  );
}
