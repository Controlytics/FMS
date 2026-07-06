import type { Permission } from '@digilog/shared';
import type { AccessKind, FlowStep } from './types';
import { deriveRolesForGate, ROLE_META } from './role-gates';

const ACCESS_COPY: Record<AccessKind, string> = {
  automatic: 'Automatic — system',
  public: 'Anyone — no login required',
  configured: 'Roles enabled in visibility config',
  authenticated: 'Any signed-in user',
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
 * or role-level gate (verified against module-flows.ts). */
function RoleBadges({ gate }: { gate: Permission[] }) {
  const roles = deriveRolesForGate(gate);
  return <RoleNameBadges names={roles} />;
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

export function FlowChart({ steps }: { steps: FlowStep[] }) {
  return (
    <ol className="space-y-0">
      {steps.map((step, i) => (
        <li key={i} className="relative">
          <div className="flex items-start gap-3">
            {/* index bubble + connector */}
            <div className="flex flex-col items-center">
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${
                  step.kind === 'decision'
                    ? 'border-amber-300 bg-amber-50 text-amber-700'
                    : step.kind === 'system'
                      ? 'border-slate-300 bg-slate-50 text-slate-500'
                      : 'border-slate-300 bg-white text-slate-700'
                }`}
              >
                {i + 1}
              </span>
              {i < steps.length - 1 && <span className="w-px flex-1 bg-slate-200 min-h-6" />}
            </div>
            {/* step card */}
            <div className="flex-1 pb-5">
              <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-slate-800">{step.label}</span>
                  <StepAccess step={step} />
                </div>
                {step.description && (
                  <p className="mt-1 text-sm text-slate-500">{step.description}</p>
                )}
                {step.branch && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-dashed border-slate-300 bg-slate-50 px-2 py-1.5">
                    <span className="text-xs font-medium text-slate-600">⤷</span>
                    <span className="text-xs font-medium text-slate-600">{step.branch.label}</span>
                    <RoleBadges gate={step.branch.gate} />
                  </div>
                )}
              </div>
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
