import { zodResolver } from '@hookform/resolvers/zod';
import { useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { Button, ErrorState, Field, Input, Notice } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from './AuthContext';

function Shell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-sm space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div><p className="text-sm font-semibold text-brand-700">Harbour Payroll</p><h1 className="text-xl font-semibold">{title}</h1></div>
        {children}
      </div>
    </div>
  );
}

const loginSchema = z.object({ email: z.string().email('Enter a valid email address'), password: z.string().min(1, 'Password is required') });

export function LoginPage() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [error, setError] = useState<unknown>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<z.infer<typeof loginSchema>>({ resolver: zodResolver(loginSchema) });
  return (
    <Shell title="Sign in">
      <form className="space-y-4" onSubmit={handleSubmit(async (v) => { setError(null); try { await login(v.email, v.password); nav('/'); } catch (e) { setError(e); } })} noValidate>
        {error ? <ErrorState error={error} /> : null}
        <Field label="Email" htmlFor="email" error={errors.email?.message}><Input id="email" type="email" autoComplete="username" {...register('email')} /></Field>
        <Field label="Password" htmlFor="password" error={errors.password?.message}><Input id="password" type="password" autoComplete="current-password" {...register('password')} /></Field>
        <Button type="submit" className="w-full" loading={isSubmitting}>Sign in</Button>
        <p className="text-center text-sm"><Link className="text-brand-700 hover:underline" to="/forgot-password">Forgot password?</Link></p>
      </form>
    </Shell>
  );
}

export function ForgotPasswordPage() {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<{ email: string }>({ resolver: zodResolver(z.object({ email: z.string().email('Enter a valid email address') })) });
  return (
    <Shell title="Reset password">
      {done ? <Notice tone="green">If the account exists, a reset link has been sent.</Notice> : (
        <form className="space-y-4" noValidate onSubmit={handleSubmit(async (v) => { try { await api.post('/auth/forgot-password', v); setDone(true); } catch (e) { setError(e); } })}>
          {error ? <ErrorState error={error} /> : null}
          <Field label="Work email" htmlFor="fp-email" error={errors.email?.message}><Input id="fp-email" type="email" {...register('email')} /></Field>
          <Button type="submit" className="w-full" loading={isSubmitting}>Send reset link</Button>
        </form>
      )}
      <p className="text-center text-sm"><Link className="text-brand-700 hover:underline" to="/login">Back to sign in</Link></p>
    </Shell>
  );
}

const resetSchema = z.object({
  newPassword: z.string().min(12, 'At least 12 characters').regex(/[a-z]/, 'Needs a lowercase letter').regex(/[A-Z]/, 'Needs an uppercase letter').regex(/\d/, 'Needs a digit'),
});

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [error, setError] = useState<unknown>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<z.infer<typeof resetSchema>>({ resolver: zodResolver(resetSchema) });
  return (
    <Shell title="Choose a new password">
      <form className="space-y-4" noValidate onSubmit={handleSubmit(async (v) => { try { await api.post('/auth/reset-password', { token: params.get('token') ?? '', newPassword: v.newPassword }); nav('/login'); } catch (e) { setError(e); } })}>
        {error ? <ErrorState error={error} /> : null}
        <Field label="New password" htmlFor="np" error={errors.newPassword?.message} hint="12+ characters with upper case, lower case and a digit"><Input id="np" type="password" autoComplete="new-password" {...register('newPassword')} /></Field>
        <Button type="submit" className="w-full" loading={isSubmitting}>Update password</Button>
      </form>
    </Shell>
  );
}
