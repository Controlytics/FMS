import { useEffect } from 'react';
import useSWR from 'swr';
import { type BrandingConfig } from '@digilog/shared';
import { getThemeById, applyTheme, DEFAULT_THEME_ID } from '@/lib/themes';
import { apiUrl } from '@/lib/url-utils';

// Last branding the server returned, so a tablet that cannot reach the API
// (offline, or before the Server Address is set) still shows the site's name,
// logo and colours rather than the built-in defaults. Per-device convenience only.
const BRANDING_CACHE_KEY = 'digilog.branding';

function readCachedBranding(): Partial<BrandingConfig> | null {
  try {
    const raw = localStorage.getItem(BRANDING_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function writeCachedBranding(b: Partial<BrandingConfig>) {
  try { localStorage.setItem(BRANDING_CACHE_KEY, JSON.stringify(b)); } catch { /* storage full / blocked */ }
}

// 2026-10-08: the fetch MUST go through apiUrl(). A bare relative '/api/...'
// never reaches the API from the APK — the WebView answers it with index.html —
// so the tablet login always fell back to the defaults ("DigiLog", default
// logo and theme) while the web login showed the configured branding.
async function fetchBranding(path: string): Promise<BrandingConfig> {
  const res = await fetch(apiUrl(path));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data && typeof data === 'object' && Object.keys(data).length > 0) writeCachedBranding(data);
  return data;
}

// Default branding values
export const defaultBranding: BrandingConfig = {
  appName: 'DigiLog',
  appTagline: '21 CFR Part 11 Compliant Digital Logbook',
  logoText: 'DL',
  logoUrl: '/logo.jpg', // Controlytics logo
  // MUST stay in step with brandingConfigSchema's defaults: this object is the
  // whole answer when the branding fetch fails (offline tablet, or the APK,
  // whose relative-URL fetch never reaches the API host). Miss a key here and
  // the tab reads "undefined".
  browserTitle: 'Filter Management System',
  faviconUrl: '',
  companyName: 'Controlytics AI Pvt Ltd',
  version: '1.0',
  primaryColor: '#1e3a5f',
  secondaryColor: '#3b82f6',
  accentColor: '#8b5cf6',
  gradientStart: '#3b82f6',
  gradientMiddle: '#8b5cf6',
  gradientEnd: '#ec4899',
  loginBgStart: '#0f172a',
  loginBgEnd: '#1e3a5f',
  colorTheme: 'ocean',
};

export function useBranding() {
  const { data, error, isLoading, mutate } = useSWR<BrandingConfig>('/api/config/branding', {
    // Public endpoint (no auth), fetched from the API host — see fetchBranding.
    fetcher: fetchBranding,
    // Cache for 5 minutes, revalidate in background
    revalidateOnFocus: false,
    revalidateOnMount: true, dedupingInterval: 5000,
  });

  // Merge data with defaults, but use default logoUrl if database has empty string
  let branding: BrandingConfig;
  const source = data && Object.keys(data).length > 0 ? data : readCachedBranding();
  if (source && Object.keys(source).length > 0) {
    branding = { ...defaultBranding, ...source };
    // If logoUrl is empty from DB, use the default logo
    if (!branding.logoUrl) {
      branding.logoUrl = defaultBranding.logoUrl;
    }
  } else {
    branding = defaultBranding;
  }

  // Apply theme CSS variables whenever branding loads or changes
  const themeId = (branding as any).colorTheme || DEFAULT_THEME_ID;
  useEffect(() => {
    const theme = getThemeById(themeId);
    applyTheme(theme.colors);
  }, [themeId]);

  return {
    branding,
    isLoading,
    error,
    mutate,
  };
}
