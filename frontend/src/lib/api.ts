const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api/v1';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

let csrfToken = '';
export const setCsrfToken = (t: string) => {
  csrfToken = t;
};

type Query = Record<string, string | number | boolean | undefined | null>;

export function qs(q?: Query): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q ?? {})) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

async function request<T>(method: string, path: string, body?: unknown, isForm = false): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: 'include',
    headers: {
      ...(body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : {}),
      ...(method !== 'GET' ? { 'X-CSRF-Token': csrfToken } : {}),
    },
    body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get('content-type') ?? '';
  if (!res.ok) {
    const j = ct.includes('json') ? await res.json().catch(() => null) : null;
    throw new ApiError(res.status, j?.error?.code ?? 'ERROR', j?.error?.message ?? res.statusText, j?.error?.details);
  }
  return (ct.includes('json') ? await res.json() : await res.blob()) as T;
}

export const api = {
  get: <T>(path: string, q?: Query) => request<T>('GET', `${path}${qs(q)}`),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  upload: <T>(path: string, file: File) => {
    const f = new FormData();
    f.append('file', file);
    return request<T>('POST', path, f, true);
  },
  /** Authenticated file fetch (PDF/CSV); the browser never sees a public URL. */
  download: async (path: string, filename: string, q?: Query) => {
    const blob = await request<Blob>('GET', `${path}${qs(q)}`);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },
  blobUrl: async (path: string) => URL.createObjectURL(await request<Blob>('GET', path)),
};

export interface Page<T> {
  data: T[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}
export interface One<T> {
  data: T;
}
