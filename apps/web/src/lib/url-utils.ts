import { getApiBase } from './api-base';

export function getPhotoUrl(url: string | undefined): string {
  if (!url) return '';
  if (url.startsWith('http')) return url;
  return `${getApiBase()}${url}`;
}
