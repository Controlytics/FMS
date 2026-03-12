import useSWR from 'swr';

export function usePaginationConfig(): [number, number, number] {
  const { data } = useSWR<{ options: [number, number, number] }>(
    '/api/config/pagination/current',
    { revalidateOnMount: true, dedupingInterval: 5000, revalidateOnFocus: false }
  );
  return data?.options ?? [10, 25, 50];
}
