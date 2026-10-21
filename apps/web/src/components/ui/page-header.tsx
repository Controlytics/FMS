import { cn } from '@/lib/cn';

/**
 * The page title block (UI redesign Phase 2, 2026-10-21). Pages used to hand-roll
 * it ~60 times with drifting markup: gradient icon tiles, gradient-clipped text,
 * 2xl/3xl titles. One component keeps every screen's top identical.
 *
 * `icon` is the <path> content of a 24x24 outline icon. `actions` sits on the
 * right and wraps under the title on narrow screens (tablet portrait). `back`
 * renders before the icon (a back button the page already owns).
 */
export interface PageHeaderProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  back?: React.ReactNode;
  className?: string;
}

export function PageHeader({ title, subtitle, icon, actions, back, className }: PageHeaderProps) {
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-4', className)}>
      <div className="flex min-w-0 items-center gap-3">
        {back}
        {icon && (
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white shadow-xs">
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              {icon}
            </svg>
          </div>
        )}
        <div className="min-w-0">
          {/* Wraps, never truncates: some titles are dynamic (block names, report labels the
              operator configures) and a clipped title hides which record the page is about. */}
          <h1 className="text-2xl font-semibold text-slate-900 [overflow-wrap:anywhere]">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
