import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { api, type One, type Page } from '@/lib/api';
import type { Ref } from '@/types';

export const useList = <T>(path: string, params: Record<string, string | number | undefined>, enabled = true) =>
  useQuery({ queryKey: [path, params], queryFn: () => api.get<Page<T>>(path, params), enabled, placeholderData: (prev) => prev });

export const useOne = <T>(path: string, enabled = true) =>
  useQuery({ queryKey: [path], queryFn: async () => (await api.get<One<T>>(path)).data, enabled });

export const useRefs = (path: 'departments' | 'designations') =>
  useQuery({ queryKey: [`/${path}`], queryFn: async () => (await api.get<One<Ref[]>>(`/${path}`)).data, staleTime: 60_000 });

/** Mutation that invalidates the given query-key prefixes on success. */
export function useAction<TBody, TRes = unknown>(fn: (body: TBody) => Promise<TRes>, invalidate: QueryKey[] = []) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => Promise.all(invalidate.map((k) => qc.invalidateQueries({ queryKey: k }))),
  });
}
