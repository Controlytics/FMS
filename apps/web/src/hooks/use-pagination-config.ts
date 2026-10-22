import { useState } from 'react';
import useSWR from 'swr';

interface PaginationConfigData {
  limit: number;
  count: number;
  options: number[];
}

export function usePaginationConfig(): number[] {
  const { data } = useSWR<PaginationConfigData>(
    '/api/config/pagination/current',
    { revalidateOnMount: true, dedupingInterval: 5000, revalidateOnFocus: false }
  );
  return data?.options ?? [10, 25, 50];
}

export function usePaginationDefaults(): { options: number[]; defaultLimit: number } {
  const { data } = useSWR<PaginationConfigData>(
    '/api/config/pagination/current',
    { revalidateOnMount: true, dedupingInterval: 5000, revalidateOnFocus: false }
  );
  return {
    options: data?.options ?? [10, 25, 50],
    defaultLimit: data?.limit ?? 20,
  };
}

/**
 * A list page's page size: the operator's own pick, else the configured default
 * (Config → Pagination, "records per page options for all list views").
 *
 * Never seed useState from the default. On a cold load the hook still returns
 * its pre-load fallback, and useState keeps whatever it got first (2026-10-21
 * D6). Nor hard-code a size: 11 pages did (20 / 25 / 50), often a size their own
 * selector did not offer (2026-10-22).
 */
export function usePageSize(): [number, (size: number) => void] {
  const { defaultLimit } = usePaginationDefaults();
  const [choice, setChoice] = useState<number | null>(null);
  return [choice ?? defaultLimit, setChoice];
}
