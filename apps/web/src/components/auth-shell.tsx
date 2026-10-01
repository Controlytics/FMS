import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useBranding } from '@/hooks/use-branding';
import { cn } from '@/lib/cn';

interface AuthShellProps {
  /** Heading of the form panel, e.g. "Sign in". */
  title: string;
  description?: ReactNode;
  /** Shows a "Back to sign in" link above the heading. Pass a path to
   *  override the target — the tablet's sign-in lives at /m/login. */
  backToLogin?: boolean | string;
  /** Wider form column for longer forms (Contact admin). */
  wide?: boolean;
  children: ReactNode;
}

/**
 * The one frame for every signed-out screen (sign in, forgot password, change
 * password, contact admin, guest request), so they read as one product.
 *
 * Two panels from `lg` up: the theme's ink on the left carries the identity
 * (logo, application name, then company + compliance line beneath it), the
 * form sits on white. Both panels are centre-aligned, horizontally and
 * vertically. Below `lg` the ink panel collapses into a header band and the
 * company line moves under the form.
 */
export function AuthShell({ title, description, backToLogin, wide, children }: AuthShellProps) {
  const { branding } = useBranding();

  return (
    <div className="flex min-h-screen flex-col lg:flex-row bg-white">
      <aside
        className="flex flex-col items-center justify-center px-8 py-8 text-center text-white lg:w-[42%] lg:max-w-xl lg:px-12 lg:py-12"
        style={{ background: 'linear-gradient(160deg, var(--theme-login-bg-end) 0%, var(--theme-login-bg-start) 100%)' }}
      >
        {branding.logoUrl ? (
          <div className="inline-flex items-center justify-center rounded-lg bg-white px-4 py-3">
            <img src={branding.logoUrl} alt={branding.companyName} className="max-h-12 w-auto object-contain lg:max-h-14" />
          </div>
        ) : (
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-lg bg-white/12 text-xl font-semibold">
            {branding.logoText}
          </div>
        )}
        <p className="mt-6 text-2xl font-semibold leading-tight lg:mt-8 lg:text-4xl">{branding.appName}</p>
        {branding.appTagline && (
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-white/70 lg:text-base">{branding.appTagline}</p>
        )}
        <div className="mt-8 hidden w-full max-w-xs border-t border-white/15 pt-6 text-sm text-white/60 lg:block">
          <p className="font-medium text-white/80">{branding.companyName}</p>
          <p className="mt-1">21 CFR Part 11 compliant electronic records</p>
          <p className="mt-1 font-mono text-xs">Version {branding.version}</p>
        </div>
      </aside>

      <main className="flex flex-1 items-center justify-center px-6 py-10 sm:px-10">
        <div className={cn('w-full', wide ? 'max-w-lg' : 'max-w-sm')}>
          <div className="text-center">
            {backToLogin && (
              <Link
                to={typeof backToLogin === 'string' ? backToLogin : '/login'}
                replace
                className="mb-5 inline-flex items-center gap-1.5 py-1 text-sm font-medium text-slate-500 hover:text-slate-800"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Back to sign in
              </Link>
            )}
            <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
            {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
          </div>

          <div className="mt-6">{children}</div>

          <div className="mt-8 text-center text-xs text-slate-500 lg:hidden">
            <p className="font-medium text-slate-600">{branding.companyName}</p>
            <p className="mt-0.5 font-mono">Version {branding.version}</p>
          </div>
        </div>
      </main>
    </div>
  );
}

/** Inline error box used by the signed-out forms. */
export function AuthError({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
      <svg className="mt-0.5 h-4 w-4 shrink-0 text-red-600" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
      </svg>
      <p className="text-sm text-red-800">{children}</p>
    </div>
  );
}

/** Confirmation panel shown after a signed-out form is sent. */
export function AuthSuccess({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3.5">
      <p className="flex items-center gap-2 text-sm font-semibold text-emerald-900">
        <svg className="h-4 w-4 text-emerald-700" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
        </svg>
        {title}
      </p>
      <p className="mt-1 text-sm text-emerald-800">{children}</p>
    </div>
  );
}
