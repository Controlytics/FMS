export const API_BASE = import.meta.env.VITE_API_URL ?? '';

export function getPhotoUrl(url: string | undefined): string {
  if (!url) return '';
  if (url.startsWith('http')) return url;
  return `${API_BASE}${url}`;
}
