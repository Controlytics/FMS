import type { Permission } from '@digilog/shared';
import type { FlowStep } from './types';
import { deriveRolesForGate, ROLE_META } from './role-gates';

function RoleBadges({ gate }: { gate: Permission[] }) {
  const roles = deriveRolesForGate(gate);
  if (roles.length === 0) {
    return <span className="text-xs text-slate-400 italic">any user</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {roles.map((name) => {
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
                  <RoleBadges gate={step.gate} />
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
