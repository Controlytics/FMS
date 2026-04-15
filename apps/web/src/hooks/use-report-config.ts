import useSWR from 'swr';
import { useBranding } from './use-branding';

export interface ReportConfig {
  // Header
  showHeader: boolean;
  showLogo: boolean;
  showCompanyName: boolean;
  showReportTitle: boolean;
  showDateTime: boolean;
  showGeneratedBy: boolean;
  customHeaderText: string;
  // Footer
  showFooter: boolean;
  showPageNumbers: boolean;
  showTotalRecords: boolean;
  customFooterText: string;
  // Layout
  recordsPerPage: number;
  // Appearance
  compactMode: boolean;
}

const DEFAULTS: ReportConfig = {
  showHeader: true,
  showLogo: true,
  showCompanyName: true,
  showReportTitle: true,
  showDateTime: true,
  showGeneratedBy: true,
  customHeaderText: '',
  showFooter: true,
  showPageNumbers: true,
  showTotalRecords: true,
  customFooterText: '',
  recordsPerPage: 25,
  compactMode: false,
};

export function useReportConfig() {
  const { data } = useSWR<Partial<ReportConfig>>(
    '/api/config/report-settings/current',
    { revalidateOnFocus: false, dedupingInterval: 10000 },
  );
  const { branding } = useBranding();

  const config: ReportConfig = { ...DEFAULTS, ...data };

  return { config, branding };
}
