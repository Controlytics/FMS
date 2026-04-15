import { useReportConfig } from '@/hooks/use-report-config';
import { useAuth } from '@/hooks/use-auth';
import { useDatetimeFormat } from '@/hooks/use-datetime-format';

interface ReportPageWrapperProps {
  title: string;
  totalRecords: number;
  page: number;
  totalPages: number;
  children: React.ReactNode;
}

export function ReportPageWrapper({ title, totalRecords, page, totalPages, children }: ReportPageWrapperProps) {
  const { config, branding } = useReportConfig();
  const { user } = useAuth();
  const { formatDate } = useDatetimeFormat();
  const now = new Date();

  return (
    <div className="space-y-0">
      {/* ── Report Header ── */}
      {config.showHeader && (
        <div className="bg-white border border-slate-200 rounded-t-xl px-6 py-4 print:border-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              {config.showLogo && branding.logoUrl && (
                <img src={branding.logoUrl} alt="Logo" className="h-10 w-auto object-contain" />
              )}
              {config.showLogo && !branding.logoUrl && (
                <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-sm"
                  style={{ background: 'linear-gradient(to bottom right, var(--theme-gradient-from), var(--theme-gradient-to))' }}>
                  {branding.logoText || 'DL'}
                </div>
              )}
              <div>
                {config.showCompanyName && (
                  <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">{branding.companyName}</p>
                )}
                {config.showReportTitle && (
                  <h2 className="text-lg font-bold text-slate-800">{title}</h2>
                )}
              </div>
            </div>
            <div className="text-right text-xs text-slate-400 space-y-0.5">
              {config.showDateTime && (
                <p>Generated: {formatDate(now.toISOString())} {now.toLocaleTimeString()}</p>
              )}
              {config.showGeneratedBy && user && (
                <p>By: {user.fullName || user.username}</p>
              )}
              {config.customHeaderText && (
                <p className="text-slate-500 font-medium">{config.customHeaderText}</p>
              )}
            </div>
          </div>
          {/* Theme accent bar */}
          <div className="h-0.5 mt-3 rounded-full" style={{ background: 'linear-gradient(to right, var(--theme-gradient-from), var(--theme-gradient-to))' }} />
        </div>
      )}

      {/* ── Report Content ── */}
      <div className={config.showHeader || config.showFooter ? '' : ''}>
        {children}
      </div>

      {/* ── Report Footer ── */}
      {config.showFooter && (
        <div className="bg-white border border-slate-200 border-t-0 rounded-b-xl px-6 py-3 flex items-center justify-between print:border-0">
          <div className="text-xs text-slate-400">
            {config.customFooterText && <span>{config.customFooterText}</span>}
            {config.customFooterText && config.showTotalRecords && <span className="mx-2">|</span>}
            {config.showTotalRecords && <span>{totalRecords} record{totalRecords !== 1 ? 's' : ''}</span>}
          </div>
          {config.showPageNumbers && (
            <div className="text-xs text-slate-400">
              Page {page} of {totalPages}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
