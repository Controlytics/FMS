export const API_BASE = 'http://localhost:3000';

export function getPhotoUrl(url: string | undefined): string {
  if (!url) return '';
  if (url.startsWith('http')) return url;
  return `${API_BASE}${url}`;
}
