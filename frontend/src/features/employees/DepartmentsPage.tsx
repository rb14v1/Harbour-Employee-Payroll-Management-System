import { useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, Loading, PageHeader, Table, Td, Th } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthContext';
import { useAction, useRefs } from '@/hooks/useApi';
import { api } from '@/lib/api';
import { can } from '@/lib/permissions';

export function DepartmentsPage() {
  const { user } = useAuth();
  const canEdit = can.manageDepartments(user!.role);
  const depts = useRefs('departments');
  const desigs = useRefs('designations');
  const [dept, setDept] = useState({ name: '', code: '' });
  const [title, setTitle] = useState('');
  const addDept = useAction(() => api.post('/departments', dept), [['/departments']]);
  const addDesig = useAction(() => api.post('/designations', { title }), [['/designations']]);

  return (
    <>
      <PageHeader title="Departments and designations" description="Reporting hierarchy is set per employee through the manager field." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Departments">
          {depts.isLoading ? <Loading /> : depts.isError ? <ErrorState error={depts.error} /> : !depts.data?.length ? <EmptyState title="No departments yet" /> : (
            <Table><thead><tr><Th>Code</Th><Th>Name</Th><Th>Status</Th></tr></thead><tbody>{depts.data.map((d) => <tr key={d._id}><Td>{d.code}</Td><Td>{d.name}</Td><Td><Badge value="active" /></Td></tr>)}</tbody></Table>
          )}
          {canEdit && (
            <form className="mt-4 grid grid-cols-[1fr_8rem_auto] items-end gap-2" onSubmit={async (e) => { e.preventDefault(); await addDept.mutateAsync(undefined); setDept({ name: '', code: '' }); }}>
              <Field label="Name" htmlFor="dn"><Input id="dn" required value={dept.name} onChange={(e) => setDept({ ...dept, name: e.target.value })} /></Field>
              <Field label="Code" htmlFor="dc"><Input id="dc" required maxLength={20} value={dept.code} onChange={(e) => setDept({ ...dept, code: e.target.value })} /></Field>
              <Button type="submit" loading={addDept.isPending}>Add</Button>
            </form>
          )}
          {addDept.isError && <div className="mt-2"><ErrorState error={addDept.error} /></div>}
        </Card>
        <Card title="Designations">
          {desigs.isLoading ? <Loading /> : !desigs.data?.length ? <EmptyState title="No designations yet" /> : (
            <Table><thead><tr><Th>Title</Th></tr></thead><tbody>{desigs.data.map((d) => <tr key={d._id}><Td>{d.title}</Td></tr>)}</tbody></Table>
          )}
          {canEdit && (
            <form className="mt-4 flex items-end gap-2" onSubmit={async (e) => { e.preventDefault(); await addDesig.mutateAsync(undefined); setTitle(''); }}>
              <div className="flex-1"><Field label="Title" htmlFor="dt"><Input id="dt" required value={title} onChange={(e) => setTitle(e.target.value)} /></Field></div>
              <Button type="submit" loading={addDesig.isPending}>Add</Button>
            </form>
          )}
          {addDesig.isError && <div className="mt-2"><ErrorState error={addDesig.error} /></div>}
        </Card>
      </div>
    </>
  );
}
