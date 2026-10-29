import { AlertCircle, Inbox, Loader2 } from 'lucide-react';
import { forwardRef, useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { ApiError } from '@/lib/api';
import { cn, label } from '@/lib/format';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
const variants: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 disabled:bg-brand-600/50',
  secondary: 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 disabled:opacity-50',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-600/50',
  ghost: 'text-slate-700 hover:bg-slate-100 disabled:opacity-50',
};

export function Button({ variant = 'primary', loading, className, children, disabled, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  return (
    <button className={cn('inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed', variants[variant], className)} disabled={disabled || loading} {...rest}>
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

const fieldCls = 'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm placeholder:text-slate-400 disabled:bg-slate-100';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} className={cn(fieldCls, className)} {...p} />;
});
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, ...p }, ref) {
  return <select ref={ref} className={cn(fieldCls, className)} {...p} />;
});
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...p }, ref) {
  return <textarea ref={ref} className={cn(fieldCls, className)} rows={3} {...p} />;
});

export function Field({ label: text, error, hint, children, htmlFor }: { label: string; error?: string; hint?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-slate-700">{text}</label>
      {children}
      {hint && !error && <p className="text-xs text-slate-500">{hint}</p>}
      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
    </div>
  );
}

export const Card = ({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) => (
  <section className={cn('rounded-lg border border-slate-200 bg-white shadow-sm', className)}>
    {(title || actions) && (
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        <div className="flex gap-2">{actions}</div>
      </header>
    )}
    <div className="p-4">{children}</div>
  </section>
);

export const PageHeader = ({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) => (
  <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
    <div>
      <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
      {description && <p className="mt-1 text-sm text-slate-600">{description}</p>}
    </div>
    <div className="flex flex-wrap gap-2">{actions}</div>
  </div>
);

const tones: Record<string, string> = {
  green: 'bg-green-100 text-green-800', amber: 'bg-amber-100 text-amber-900', red: 'bg-red-100 text-red-800', blue: 'bg-blue-100 text-blue-800', slate: 'bg-slate-100 text-slate-700',
};
const statusTone: Record<string, string> = {
  active: 'green', approved: 'green', paid: 'green', reconciled: 'green', resolved: 'green', calculated: 'blue', pending_approval: 'amber', processing: 'amber', payment_processing: 'amber', reconciliation_pending: 'amber', pending: 'amber', open: 'amber', rejected: 'red', cancelled: 'red', inactive: 'slate', draft: 'slate', on_notice: 'amber', error: 'red', warning: 'amber',
};
export const Badge = ({ value, tone }: { value: string; tone?: keyof typeof tones }) => (
  <span className={cn('inline-block rounded-full px-2 py-0.5 text-xs font-medium', tones[tone ?? statusTone[value] ?? 'slate'])}>{label(value)}</span>
);

export const Loading = ({ text = 'Loading…' }: { text?: string }) => (
  <div role="status" className="flex items-center justify-center gap-2 py-10 text-sm text-slate-600"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />{text}</div>
);
export const EmptyState = ({ title, hint }: { title: string; hint?: string }) => (
  <div className="flex flex-col items-center gap-1 py-10 text-center"><Inbox className="h-8 w-8 text-slate-400" aria-hidden /><p className="text-sm font-medium text-slate-700">{title}</p>{hint && <p className="text-xs text-slate-500">{hint}</p>}</div>
);
export const errorMessage = (e: unknown) => (e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Something went wrong');
export const ErrorState = ({ error, retry }: { error: unknown; retry?: () => void }) => (
  <div role="alert" className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
    <div className="flex-1">{errorMessage(error)}{error instanceof ApiError && Array.isArray(error.details) && (
      <ul className="mt-1 list-disc pl-5 text-xs">{(error.details as { row?: number; path?: string; message: string }[]).slice(0, 10).map((d, i) => <li key={i}>{d.row ? `Row ${d.row}: ` : d.path ? `${d.path}: ` : ''}{typeof d === 'string' ? d : d.message}</li>)}</ul>
    )}</div>
    {retry && <Button variant="secondary" onClick={retry}>Retry</Button>}
  </div>
);
export const Notice = ({ tone = 'blue', children }: { tone?: 'blue' | 'amber' | 'green' | 'red'; children: ReactNode }) => (
  <div role="status" className={cn('rounded-md px-3 py-2 text-sm', tones[tone])}>{children}</div>
);

export function Modal({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('input,textarea,select,button')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl">
        <h2 className="mb-3 text-base font-semibold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

/** Confirmation for consequential actions. Optional comment is required when `commentRequired`. */
export function ConfirmDialog({ open, title, message, confirmLabel, danger, withComment, commentRequired, commentLabel = 'Comment', loading, error, onConfirm, onClose }: {
  open: boolean; title: string; message: ReactNode; confirmLabel: string; danger?: boolean; withComment?: boolean; commentRequired?: boolean; commentLabel?: string; loading?: boolean; error?: unknown;
  onConfirm: (comment: string) => void; onClose: () => void;
}) {
  const [comment, setComment] = useState('');
  const invalid = withComment && commentRequired && comment.trim().length < 3;
  return (
    <Modal open={open} title={title} onClose={onClose}>
      <div className="space-y-3 text-sm text-slate-700">
        <div>{message}</div>
        {withComment && <Field label={commentLabel} htmlFor="confirm-comment"><Textarea id="confirm-comment" value={comment} onChange={(e) => setComment(e.target.value)} /></Field>}
        {error ? <ErrorState error={error} /> : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={loading} disabled={invalid} onClick={() => onConfirm(comment.trim())}>{confirmLabel}</Button>
        </div>
      </div>
    </Modal>
  );
}

export function Pagination({ page, totalPages, total, onPage }: { page: number; totalPages: number; total: number; onPage: (p: number) => void }) {
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between pt-3 text-sm text-slate-600">
      <span>{total} record{total === 1 ? '' : 's'}</span>
      <div className="flex items-center gap-2">
        <Button variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
        <span aria-live="polite">Page {page} of {totalPages}</span>
        <Button variant="secondary" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>Next</Button>
      </div>
    </nav>
  );
}

export const Table = ({ children }: { children: ReactNode }) => (
  <div className="overflow-x-auto"><table className="w-full text-left text-sm">{children}</table></div>
);
export const Th = ({ children, right, onClick, sorted }: { children?: ReactNode; right?: boolean; onClick?: () => void; sorted?: 'asc' | 'desc' | null }) => (
  <th scope="col" aria-sort={sorted ? (sorted === 'asc' ? 'ascending' : 'descending') : undefined} className={cn('whitespace-nowrap border-b border-slate-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500', right && 'text-right')}>
    {onClick ? <button onClick={onClick} className="uppercase hover:text-slate-900">{children}{sorted === 'asc' ? ' ↑' : sorted === 'desc' ? ' ↓' : ''}</button> : children}
  </th>
);
export const Td = ({ children, right, className }: { children?: ReactNode; right?: boolean; className?: string }) => (
  <td className={cn('border-b border-slate-100 px-3 py-2', right && 'text-right tabular-nums', className)}>{children}</td>
);

export const Stat = ({ label: l, value, hint }: { label: string; value: ReactNode; hint?: string }) => (
  <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{l}</p>
    <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</p>
    {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
  </div>
);
