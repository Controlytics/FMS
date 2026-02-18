import useSWR from 'swr';

export function usePaginationConfig(): [number, number, number] {
  const { data } = useSWR<{ options: [number, number, number] }>(
    '/api/config/pagination/current',
    { dedupingInterval: 60000, revalidateOnFocus: false }
  );
  return data?.options ?? [10, 25, 50];
}
