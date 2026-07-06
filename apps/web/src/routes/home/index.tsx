import { MODULE_FLOWS, CATEGORY_ORDER } from './module-flows';
import { FlowChart } from './FlowChart';
import { ROLE_META } from './role-gates';

function slug(id: string) { return `mod-${id}`; }

export default function HomePage() {
  const byCategory = CATEGORY_ORDER
    .map((cat) => ({ cat, mods: MODULE_FLOWS.filter((m) => m.category === cat) }))
    .filter((g) => g.mods.length > 0);

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      {/* Intro */}
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800">Module Guide</h1>
        <p className="mt-2 text-slate-600">
          How each module works, step by step, with the role(s) allowed to perform
          each action. Default system roles are shown; custom roles inherit an
          action whenever they hold that step's permission.
        </p>
      </header>

      {/* Role legend */}
      <section className="mb-8 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Roles</h2>
        <div className="flex flex-wrap gap-2">
          {ROLE_META.map((m) => (
            <span key={m.name} className={`inline-block rounded-full border px-2.5 py-1 text-xs font-medium ${m.badgeClass}`}>
              {m.displayName}
            </span>
          ))}
        </div>
      </section>

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
          <div className="space-y-8">
            {mods.map((m) => (
              <article key={m.id} id={slug(m.id)} className="scroll-mt-6">
                <h3 className="text-base font-semibold text-slate-800">{m.title}</h3>
                <p className="mb-3 text-sm text-slate-500">{m.summary}</p>
                <FlowChart steps={m.steps} />
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
