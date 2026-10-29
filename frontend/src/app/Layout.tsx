import { BarChart3, Building2, CalendarClock, ClipboardCheck, FileText, Gauge, LogOut, Menu, ScrollText, Settings, ShieldCheck, UserCog, Users, Wallet, Wrench, X } from 'lucide-react';
import { useState, type ComponentType } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '@/features/auth/AuthContext';
import { cn } from '@/lib/format';
import { can, ROLE_LABELS, type Role } from '@/lib/permissions';

interface NavItem { to: string; label: string; icon: ComponentType<{ className?: string }>; show: (r: Role) => boolean }

export const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: Gauge, show: (r) => r !== 'employee' },
  { to: '/my-pay', label: 'My Pay', icon: Wallet, show: () => true },
  { to: '/employees', label: 'Employees', icon: Users, show: (r) => r !== 'employee' },
  { to: '/departments', label: 'Departments', icon: Building2, show: can.manageDepartments },
  { to: '/salary-structures', label: 'Salary Structures', icon: ScrollText, show: can.viewSalary },
  { to: '/payroll-inputs', label: 'Payroll Inputs', icon: CalendarClock, show: can.manageInputs },
  { to: '/payroll', label: 'Payroll Processing', icon: Wrench, show: (r) => can.viewPayroll(r) && r !== 'finance_approver' && r !== 'system_admin' },
  { to: '/approvals', label: 'Payroll Approvals', icon: ClipboardCheck, show: (r) => r === 'finance_approver' || r === 'payroll_admin' },
  { to: '/payslips', label: 'Payslips', icon: FileText, show: () => true },
  { to: '/requests', label: 'Correction Requests', icon: ShieldCheck, show: can.reviewRequests },
  { to: '/reports', label: 'Reports', icon: BarChart3, show: can.viewReports },
  { to: '/audit-logs', label: 'Audit Logs', icon: ScrollText, show: can.viewAudit },
  { to: '/settings', label: 'Organisation Settings', icon: Settings, show: (r) => can.manageOrg(r) || can.managePolicy(r) },
  { to: '/users', label: 'User Management', icon: UserCog, show: can.manageUsers },
];

export function Layout() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  if (!user) return null;
  const items = NAV.filter((n) => n.show(user.role));

  const nav = (
    <nav aria-label="Main" className="flex-1 space-y-1 overflow-y-auto p-3">
      {items.map(({ to, label, icon: Icon }) => (
        <NavLink key={to} to={to} end={to === '/'} onClick={() => setOpen(false)}
          className={({ isActive }) => cn('flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium', isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-700 hover:bg-slate-100')}>
          <Icon className="h-4 w-4" aria-hidden />{label}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="border-b border-slate-200 px-5 py-4 text-lg font-semibold text-brand-900">Harbour Payroll</div>
        {nav}
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-white">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 text-lg font-semibold text-brand-900">Harbour Payroll
              <button aria-label="Close menu" onClick={() => setOpen(false)}><X className="h-5 w-5" /></button></div>
            {nav}
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
          <button className="lg:hidden" aria-label="Open menu" onClick={() => setOpen(true)}><Menu className="h-5 w-5" /></button>
          <div className="ml-auto flex items-center gap-4">
            <div className="text-right text-sm"><p className="font-medium">{user.name}</p><p className="text-xs text-slate-500">{ROLE_LABELS[user.role]}</p></div>
            <button onClick={() => void logout()} className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-slate-700 hover:bg-slate-100"><LogOut className="h-4 w-4" aria-hidden />Sign out</button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 p-4 sm:p-6"><Outlet /></main>
      </div>
    </div>
  );
}
