import type { Permission } from '@digilog/shared';
import type { AccessKind, FlowStep, StepKind } from './types';
import { deriveRolesForGate, ROLE_META } from './role-gates';

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

function RoleNameBadges({ names }: { names: string[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {names.map((name) => {
        const meta = ROLE_META.find((m) => m.name === name)!;
        return (
          <span
            key={name}
            className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium ${meta.badgeClass}`}
          >
            {meta.displayName}
          </span>
        );
      })}
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

/** Branch access is gate-only today — no branch in the catalog has an empty
 * or role-level gate (verified against module-flows.ts + integrity test). */
function RoleBadges({ gate }: { gate: Permission[] }) {
  return <RoleNameBadges names={deriveRolesForGate(gate)} />;
}

/**
 * Resolves a step's access display in order: permission gate → role gate →
 * access marker → a loud "unspecified" warning. No silent "any user"
 * catch-all — every step must resolve to one of the three real signals
 * (enforced by the module-flows integrity test).
 */
function StepAccess({ step }: { step: FlowStep }) {
  if (step.gate.length > 0) {
    return <RoleBadges gate={step.gate} />;
  }
  if (step.gateRoles && step.gateRoles.length > 0) {
    return <RoleNameBadges names={step.gateRoles} />;
  }
  if (step.access) {
    return <AccessChip access={step.access} />;
  }
  return <span className="text-xs font-semibold text-red-600">⚠ access unspecified</span>;
}

/** Horizontal connector between two consecutive step cards: a line + arrowhead,
 * vertically centred on the card row. */
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

/** Two-line clamp without depending on the line-clamp plugin. */
const CLAMP_3: React.CSSProperties = {
  display: '-webkit-box',
  WebkitLineClamp: 3,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
};

function StepCard({ step, index }: { step: FlowStep; index: number }) {
  return (
    <div className="relative w-52 shrink-0">
      <div className={`rounded-lg border border-l-4 border-slate-200 bg-white p-3 shadow-sm ${KIND_ACCENT[step.kind]}`}>
        <div className="mb-1.5 flex items-start gap-2">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-500">
            {index + 1}
          </span>
          <span className="text-sm font-medium leading-tight text-slate-800">{step.label}</span>
        </div>
        <StepAccess step={step} />
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
            <RoleBadges gate={step.branch.gate} />
          </div>
        </div>
      )}
    </div>
  );
}

export function FlowChart({ steps }: { steps: FlowStep[] }) {
  const hasBranch = steps.some((s) => s.branch);
  return (
    <div className="overflow-x-auto">
      {/* w-max lets the row take its intrinsic width so it overflows (and
          scrolls) instead of squashing; extra bottom padding reserves room for
          any branch cards that hang below. */}
      <ol className={`flex w-max items-center pt-1 ${hasBranch ? 'pb-28' : 'pb-1'}`}>
        {steps.map((step, i) => (
          <li key={i} className="flex items-center">
            <StepCard step={step} index={i} />
            {i < steps.length - 1 && <ArrowConnector />}
          </li>
        ))}
      </ol>
    </div>
  );
}
