import { type SWRConfiguration } from 'swr';
import { apiClient } from './api-client';

export const swrConfig: SWRConfiguration = {
  fetcher: (url: string) => apiClient.get(url),
  revalidateOnFocus: false,
  shouldRetryOnError: false,
  dedupingInterval: 5000,
};
