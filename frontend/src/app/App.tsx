import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '@/features/auth/AuthContext';
import { LoginPage, ForgotPasswordPage, ResetPasswordPage } from '@/features/auth/AuthPages';
import { Loading } from '@/components/ui';
import { DashboardPage } from '@/features/reports/DashboardPage';
import { ReportsPage } from '@/features/reports/ReportsPage';
import { EmployeeDetailPage, EmployeeFormPage, EmployeesPage } from '@/features/employees/EmployeePages';
import { DepartmentsPage } from '@/features/employees/DepartmentsPage';
import { SalaryStructuresPage, SalaryStructureEditorPage } from '@/features/salary-structures/SalaryPages';
import { PayrollInputsPage } from '@/features/payroll/PayrollInputsPage';
import { PayrollPeriodsPage, PayrollBatchPage } from '@/features/payroll/PayrollPages';
import { ApprovalsPage } from '@/features/payroll/ApprovalsPage';
import { PayslipsPage } from '@/features/payslips/PayslipsPage';
import { MyPayPage } from '@/features/payslips/MyPayPage';
import { RequestsPage } from '@/features/payslips/RequestsPage';
import { AuditLogsPage } from '@/features/settings/AuditLogsPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { UsersPage } from '@/features/settings/UsersPage';
import { Layout } from './Layout';

export function App() {
  const { user, loading } = useAuth();
  if (loading) return <Loading text="Starting…" />;

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  const home = user.role === 'employee' ? '/my-pay' : '/';
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={user.role === 'employee' ? <Navigate to="/my-pay" replace /> : <DashboardPage />} />
        <Route path="my-pay" element={<MyPayPage />} />
        <Route path="employees" element={<EmployeesPage />} />
        <Route path="employees/new" element={<EmployeeFormPage />} />
        <Route path="employees/:id" element={<EmployeeDetailPage />} />
        <Route path="employees/:id/edit" element={<EmployeeFormPage />} />
        <Route path="departments" element={<DepartmentsPage />} />
        <Route path="salary-structures" element={<SalaryStructuresPage />} />
        <Route path="salary-structures/new" element={<SalaryStructureEditorPage />} />
        <Route path="salary-structures/:id" element={<SalaryStructureEditorPage />} />
        <Route path="payroll-inputs" element={<PayrollInputsPage />} />
        <Route path="payroll" element={<PayrollPeriodsPage />} />
        <Route path="payroll/:periodId" element={<PayrollBatchPage />} />
        <Route path="approvals" element={<ApprovalsPage />} />
        <Route path="payslips" element={<PayslipsPage />} />
        <Route path="requests" element={<RequestsPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="audit-logs" element={<AuditLogsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="*" element={<Navigate to={home} replace />} />
      </Route>
    </Routes>
  );
}
