import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, setCsrfToken, type One } from '@/lib/api';
import type { Role } from '@/lib/permissions';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  employeeId?: string;
}

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const qc = useQueryClient();

  useEffect(() => {
    api
      .get<One<AuthUser & { csrfToken: string }>>('/auth/me')
      .then((r) => {
        setCsrfToken(r.data.csrfToken);
        setUser(r.data);
      })
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api.post<One<{ csrfToken: string; user: AuthUser }>>('/auth/login', { email, password });
    setCsrfToken(r.data.csrfToken);
    qc.clear();
    setUser(r.data.user);
  }, [qc]);

  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => undefined);
    setCsrfToken('');
    qc.clear();
    setUser(null);
  }, [qc]);

  return <Ctx.Provider value={{ user, loading, login, logout }}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}

export function useRole(): Role {
  const { user } = useAuth();
  if (!user) throw new Error('No user');
  return user.role;
}
