import { useState } from 'react';
import useSWR from 'swr';
import { useAuth } from '@/hooks/use-auth';
import { MODULE_FLOWS, CATEGORY_ORDER } from './module-flows';
import { FlowChart } from './FlowChart';
import { viewerCanSeeModule, type RoleAccess, type ViewerCtx } from './viewer-access';

function slug(id: string) { return `mod-${id}`; }

/** A role's colour may be a Tailwind class (default roles) or a raw #hex/rgb (custom roles). */
function RoleLegendBadge({ role }: { role: RoleAccess }) {
  const isRaw = /^(#|rgb|hsl)/i.test(role.color);
  return (
    <span
      style={isRaw ? { backgroundColor: role.color } : undefined}
      className={`inline-block rounded-full px-2.5 py-1 text-xs font-medium text-white shadow-sm ${isRaw ? '' : role.color}`}
    >
      {role.displayName}
    </span>
  );
}

export default function HomePage() {
  const { user } = useAuth();
  const { data: matrix } = useSWR<{ roles: RoleAccess[] }>('/api/roles/access-matrix');
  const { data: myConfig } = useSWR<{ sidebarItems?: string[] }>('/api/config/my-config');
  const { data: qnn } = useSWR<{ visible: boolean }>('/api/pm-schedules/qnn/visible');

  // Audit view: every module + every role permitted by the backend gate,
  // regardless of the viewer's or any role's sidebar. Default = the viewer's
  // own modules (mirrors their sidebar).
  const [auditView, setAuditView] = useState(false);

  const roles = matrix?.roles ?? [];

  // Which module flowcharts THIS viewer sees — mirrors their own sidebar.
  const viewer: ViewerCtx = {
    role: user?.role ?? '',
    permissions: user?.permissions ?? [],
    sidebarItems: (myConfig?.sidebarItems as string[]) ?? [],
    qnnVisible: qnn?.visible ?? false,
  };
  const visibleModules = auditView
    ? MODULE_FLOWS
    : MODULE_FLOWS.filter((m) => viewerCanSeeModule(m.id, viewer));

  const byCategory = CATEGORY_ORDER
    .map((cat) => ({ cat, mods: visibleModules.filter((m) => m.category === cat) }))
    .filter((g) => g.mods.length > 0);

  const loading = !user || !matrix;

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <header className="mb-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-2xl font-bold text-slate-800">Module Guide</h1>
          {/* View toggle: personalized vs full audit view. */}
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-sm" role="group" aria-label="Guide view">
            <button
              type="button"
              onClick={() => setAuditView(false)}
              aria-pressed={!auditView}
              className={`rounded-md px-3 py-1.5 font-medium transition-colors ${!auditView ? 'bg-white text-cyan-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              My modules
            </button>
            <button
              type="button"
              onClick={() => setAuditView(true)}
              aria-pressed={auditView}
              className={`rounded-md px-3 py-1.5 font-medium transition-colors ${auditView ? 'bg-white text-cyan-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              All modules (audit)
            </button>
          </div>
        </div>
        <p className="mt-2 text-slate-600">
          {auditView
            ? 'Audit view — every module and every role permitted to perform each operation, from your live role configuration (independent of any role’s sidebar).'
            : 'How each module works, step by step, with the role(s) configured to perform each operation. Roles come live from your role configuration, so custom roles and permission changes are reflected. You see the modules your role can access.'}
        </p>
      </header>

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-500">
          Loading roles…
        </div>
      ) : (
        <>
          {/* Live role legend */}
          <section className="mb-8 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Roles</h2>
            <div className="flex flex-wrap gap-2">
              {roles.map((r) => (
                <RoleLegendBadge key={r.name} role={r} />
              ))}
            </div>
          </section>

          {byCategory.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-500">
              No modules are assigned to your role yet.
            </div>
          ) : (
            <>
              {/* Table of contents */}
              <nav className="mb-8 rounded-xl border border-slate-200 bg-white p-4">
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Modules</h2>
                {byCategory.map(({ cat, mods }) => (
                  <div key={cat} className="mb-3 last:mb-0">
                    <p className="text-xs font-semibold text-slate-400">{cat}</p>
                    <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                      {mods.map((m) => (
                        <li key={m.id}>
                          <a href={`#${slug(m.id)}`} className="text-sm text-cyan-700 hover:underline">{m.title}</a>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </nav>

              {/* Sections */}
              {byCategory.map(({ cat, mods }) => (
                <section key={cat} className="mb-10">
                  <h2 className="mb-4 border-b border-slate-200 pb-1 text-lg font-bold text-slate-700">{cat}</h2>
                  <div className="space-y-10">
                    {mods.map((m) => (
                      <article key={m.id} id={slug(m.id)} className="scroll-mt-6">
                        <h3 className="text-base font-semibold text-slate-800">{m.title}</h3>
                        <p className="mb-3 text-sm text-slate-500">{m.summary}</p>
                        <FlowChart steps={m.steps} moduleId={m.id} roles={roles} auditMode={auditView} />
                      </article>
                    ))}
                  </div>
                </section>
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}
