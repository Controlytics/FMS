import useSWR from 'swr';
import { type BrandingConfig } from '@digilog/shared';

// Default branding values
export const defaultBranding: BrandingConfig = {
  appName: 'DigiLog',
  appTagline: '21 CFR Part 11 Compliant Digital Logbook',
  logoText: 'DL',
  logoUrl: '/logo.jpg', // Controlytics logo
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
};

export function useBranding() {
  const { data, error, isLoading, mutate } = useSWR<BrandingConfig>('/api/config/branding', {
    // Don't require auth for this endpoint
    fetcher: (url: string) => fetch(url).then(res => res.json()),
    // Cache for 5 minutes, revalidate in background
    revalidateOnFocus: false,
    dedupingInterval: 300000,
  });

  // Merge data with defaults, but use default logoUrl if database has empty string
  let branding: BrandingConfig;
  if (data && Object.keys(data).length > 0) {
    branding = { ...defaultBranding, ...data };
    // If logoUrl is empty from DB, use the default logo
    if (!branding.logoUrl) {
      branding.logoUrl = defaultBranding.logoUrl;
    }
  } else {
    branding = defaultBranding;
  }

  return {
    branding,
    isLoading,
    error,
    mutate,
  };
}
