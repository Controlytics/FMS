import type { AccessKind, FlowStep, StepKind } from './types';
import { rolesForStep, rolesForGate, type RoleAccess } from './viewer-access';

const ACCESS_COPY: Record<AccessKind, string> = {
  automatic: 'Automatic — system',
  public: 'Anyone — no login required',
  configured: 'Roles enabled in visibility config',
  authenticated: 'Any signed-in user',
};

/** Left-accent colour per step kind — echoes the cleaning-profile pipeline's
 * colour-coded node cards, adapted to the light theme. */
const KIND_ACCENT: Record<StepKind, string> = {
  action: 'border-l-cyan-500',
  decision: 'border-l-amber-400',
  system: 'border-l-slate-400',
};

/** A role's colour may be a Tailwind class (default roles) or a raw #hex/rgb
 * (custom roles); render each appropriately. */
function RoleBadge({ role }: { role: RoleAccess }) {
  const isRaw = /^(#|rgb|hsl)/i.test(role.color);
  return (
    <span
      style={isRaw ? { backgroundColor: role.color } : undefined}
      className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium text-white shadow-sm ${isRaw ? '' : role.color}`}
    >
      {role.displayName}
    </span>
  );
}

function RoleBadges({ roles }: { roles: RoleAccess[] }) {
  if (roles.length === 0) {
    return <span className="text-[11px] italic text-slate-400">no role configured</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {roles.map((r) => (
        <RoleBadge key={r.name} role={r} />
      ))}
    </div>
  );
}

function AccessChip({ access }: { access: AccessKind }) {
  return (
    <span className="inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium bg-slate-100 text-slate-600 border-slate-200">
      {ACCESS_COPY[access]}
    </span>
  );
}

/** Which role(s) perform this step, from the live access matrix. Steps that
 * aren't permission/role-gated (automatic/public/configured) show a chip. */
function StepAccess({ step, moduleId, roles }: { step: FlowStep; moduleId: string; roles: RoleAccess[] }) {
  const stepRoles = rolesForStep(step, moduleId, roles);
  if (stepRoles === null) return <AccessChip access={step.access!} />;
  return <RoleBadges roles={stepRoles} />;
}

/** Horizontal connector between two consecutive step cards: a line + arrowhead. */
function ArrowConnector() {
  return (
    <div className="flex shrink-0 items-center px-0.5 text-slate-300" aria-hidden="true">
      <span className="block h-px w-5 bg-slate-300" />
      <svg className="-ml-1 h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 6l6 6-6 6" />
      </svg>
    </div>
  );
}

/** Three-line clamp without depending on the line-clamp plugin. */
const CLAMP_3: React.CSSProperties = {
  display: '-webkit-box',
  WebkitLineClamp: 3,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
};

function StepCard({ step, index, moduleId, roles }: { step: FlowStep; index: number; moduleId: string; roles: RoleAccess[] }) {
  return (
    <div className="relative w-52 shrink-0">
      <div className={`rounded-lg border border-l-4 border-slate-200 bg-white p-3 shadow-sm ${KIND_ACCENT[step.kind]}`}>
        <div className="mb-1.5 flex items-start gap-2">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-500">
            {index + 1}
          </span>
          <span className="text-sm font-medium leading-tight text-slate-800">{step.label}</span>
        </div>
        <StepAccess step={step} moduleId={moduleId} roles={roles} />
        {step.description && (
          <p className="mt-2 text-xs text-slate-500" style={CLAMP_3} title={step.description}>
            {step.description}
          </p>
        )}
      </div>

      {/* Branch drops below the card, connected by a down-arrow. Absolutely
          positioned so it never shifts the horizontal main-flow alignment. */}
      {step.branch && (
        <div className="absolute left-1/2 top-full flex -translate-x-1/2 flex-col items-center">
          <svg className="my-0.5 h-5 w-4 text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 5v14m0 0l6-6m-6 6l-6-6" />
          </svg>
          <div className="w-48 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-2.5 shadow-sm">
            <p className="mb-1 text-xs font-medium text-slate-600">{step.branch.label}</p>
            <RoleBadges roles={rolesForGate(step.branch.gate, moduleId, roles)} />
          </div>
        </div>
      )}
    </div>
  );
}

export function FlowChart({ steps, moduleId, roles }: { steps: FlowStep[]; moduleId: string; roles: RoleAccess[] }) {
  const hasBranch = steps.some((s) => s.branch);
  return (
    <div className="overflow-x-auto">
      {/* w-max lets the row take its intrinsic width so it overflows (and
          scrolls) instead of squashing; extra bottom padding reserves room for
          any branch cards that hang below. */}
      <ol className={`flex w-max items-center pt-1 ${hasBranch ? 'pb-28' : 'pb-1'}`}>
        {steps.map((step, i) => (
          <li key={i} className="flex items-center">
            <StepCard step={step} index={i} moduleId={moduleId} roles={roles} />
            {i < steps.length - 1 && <ArrowConnector />}
          </li>
        ))}
      </ol>
    </div>
  );
}
