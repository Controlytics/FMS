/**
 * What an always-on re-auth action shows on the policy screens (Config → Action
 * Re-auth, Roles & Access → Re-auth) in place of its role checkboxes. The server
 * signs it for every role with `enforceReauthAlways` (ALWAYS_REAUTH_ACTIONS in
 * @digilog/shared), so
 * there is nothing to switch. Text, not a disabled checkbox — a greyed tick
 * reads as "off".
 */
export function AlwaysRequiredBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600">
      <svg className="w-3.5 h-3.5 text-slate-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
      </svg>
      Always required — every role, including Super Admin
    </span>
  );
}
