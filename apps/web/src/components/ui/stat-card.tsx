import { Link } from 'react-router-dom';
import { cn } from '@/lib/cn';

/**
 * One stat tile for every page (UI redesign Phase 2, 2026-10-21). Replaces four
 * identical page-local copies (My Tasks, Retirement List, Replacement List, AHU
 * filter-set config) and the dashboard's own variant.
 *
 * `icon` is the <path> content of a 24x24 outline icon (the pages already carry
 * these), drawn inside a tinted tile. The tile is brand-coloured unless the page
 * passes its own `iconBg` / `iconColor` — status tiles keep their semantic
 * colour (emerald = done, amber = pending, red = rejected ...), never the brand.
 * With `href` the whole card is a link.
 */
export interface StatCardProps {
  label: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
  iconBg?: string;
  iconColor?: string;
  href?: string;
  /** 'lg' = dashboard tiles (bigger number, "View details" line when linked). */
  size?: 'md' | 'lg';
  className?: string;
}

export function StatCard({
  label, value, icon, iconBg = 'bg-brand-50', iconColor = 'text-brand-600', href, size = 'md', className,
}: StatCardProps) {
  const lg = size === 'lg';
  const body = (
    <div
      className={cn(
        'h-full rounded-xl border border-slate-200 bg-white shadow-xs',
        lg ? 'p-5' : 'p-4',
        href && 'transition-colors hover:border-brand-300',
        className,
      )}
    >
      <div className="flex items-center gap-3">
        {icon && (
          <div className={cn('flex shrink-0 items-center justify-center rounded-lg', lg ? 'h-11 w-11' : 'h-10 w-10', iconBg)}>
            <svg className={cn(lg ? 'h-6 w-6' : 'h-5 w-5', iconColor)} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              {icon}
            </svg>
          </div>
        )}
        <div className="min-w-0">
          <div className={cn('font-semibold leading-tight text-slate-900 tabular-nums', lg ? 'text-3xl' : 'text-xl')}>{value}</div>
          {/* Wraps, never truncates: at tablet width a 4-up row clipped "Due Now" to "D...". */}
          <div className="text-xs font-medium leading-snug text-slate-500">{label}</div>
        </div>
      </div>
      {href && lg && (
        <div className="mt-3 flex items-center text-xs font-medium text-slate-500 group-hover:text-brand-700">
          View details
          <svg className="ml-1 h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </div>
      )}
    </div>
  );
  return href ? <Link to={href} className="group block">{body}</Link> : body;
}
