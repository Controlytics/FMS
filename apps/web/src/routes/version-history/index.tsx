/**
 * Version History — cross-entity audit-history viewer.
 *
 * Surfaces the four versioned-definition histories DigiLog tracks server-side:
 *   - FilterCleaningProfile lineage (Phase A.2)
 *   - FilterProfile sidecar       (Phase A.3)
 *   - ChecklistProfile sidecar    (Phase A.1)
 *   - EquipmentGroup composite    (Phase A.4)
 *
 * Gated by the VERSION_HISTORY_VIEW permission. SUPER_ADMIN by default;
 * assignable to other roles via Role Privileges → Audit / Versions.
 *
 * v1 layout: tab bar across the top, master-detail per tab. Click an entity in
 * the left list, the right pane lists its archived versions newest-first.
 * Click a version row to see the frozen snapshot in a modal (JSON pretty-print
 * for v1; structured per-entity viewer is a follow-up).
 */
import { useState } from 'react';
import useSWR from 'swr';

type EntityKind = 'cleaning-profile' | 'filter-profile' | 'checklist-profile' | 'equipment-group';

const TABS: { id: EntityKind; label: string; listEndpoint: string; itemLabel: (it: any) => string; }[] = [
  {
    id: 'cleaning-profile',
    label: 'Cleaning Profiles',
    listEndpoint: '/api/filter-cleaning-profiles?page=1&limit=200',
    itemLabel: it => `${it.name ?? '(unnamed)'} · v${it.version ?? '?'}`,
  },
  {
    id: 'filter-profile',
    label: 'Filter Profiles',
    listEndpoint: '/api/filter-profiles?page=1&limit=200',
    itemLabel: it => `${it.name ?? '(unnamed)'} · v${it.version ?? '?'}`,
  },
  {
    id: 'checklist-profile',
    label: 'Checklist Profiles',
    listEndpoint: '/api/checklist-profiles?page=1&limit=200',
    itemLabel: it => `${it.name ?? '(unnamed)'} · v${it.version ?? '?'}`,
  },
  {
    id: 'equipment-group',
    label: 'Equipment Groups',
    listEndpoint: '/api/equipment-groups',
    itemLabel: it => `${it.name ?? '(unnamed)'} · v${it.version ?? '?'}`,
  },
];

function versionsEndpoint(kind: EntityKind, id: string): string {
  switch (kind) {
    case 'cleaning-profile': return `/api/filter-cleaning-profiles/${id}/versions`;
    case 'filter-profile': return `/api/filter-profiles/${id}/versions`;
    case 'checklist-profile': return `/api/checklist-profiles/${id}/versions`;
    case 'equipment-group': return `/api/equipment-groups/${id}/versions`;
  }
}

function snapshotEndpoint(kind: EntityKind, id: string, version: number): string {
  switch (kind) {
    case 'cleaning-profile': return `/api/filter-cleaning-profiles/${id}/versions/${version}`;
    case 'filter-profile': return `/api/filter-profiles/${id}/versions/${version}`;
    case 'checklist-profile': return `/api/checklist-profiles/${id}/versions/${version}`;
    case 'equipment-group': return `/api/equipment-groups/${id}/versions/${version}`;
  }
}

export function VersionHistoryPage() {
  const [tab, setTab] = useState<EntityKind>('cleaning-profile');
  const [selected, setSelected] = useState<{ kind: EntityKind; id: string; name: string } | null>(null);
  const [snapshot, setSnapshot] = useState<{ kind: EntityKind; id: string; version: number } | null>(null);

  const tabConfig = TABS.find(t => t.id === tab)!;
  // Reset selection when tab changes — different entity kinds have different IDs.
  const onTabChange = (next: EntityKind) => {
    setTab(next);
    setSelected(null);
    setSnapshot(null);
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center gap-3">
        <div className="p-3 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-500/25">
          <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Version History</h1>
          <p className="text-sm text-slate-500">Audit-replay history for versioned definitions. Updates archive the previous state into a sidecar; cycles pin to a specific version at start.</p>
        </div>
      </div>

      <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => onTabChange(t.id)}
            className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-all ${
              tab === t.id ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <EntityList
          tabConfig={tabConfig}
          selectedId={selected?.id ?? null}
          onSelect={(id, name) => { setSelected({ kind: tab, id, name }); setSnapshot(null); }}
        />
        <div className="md:col-span-2 bg-white rounded-2xl border-2 border-slate-200 p-6 shadow-sm min-h-[20rem]">
          {selected ? (
            <VersionTimeline
              kind={selected.kind}
              entityId={selected.id}
              entityName={selected.name}
              onPickVersion={v => setSnapshot({ kind: selected.kind, id: selected.id, version: v })}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-slate-400">
              Pick an entity on the left to see its version timeline.
            </div>
          )}
        </div>
      </div>

      {snapshot && (
        <SnapshotModal
          kind={snapshot.kind}
          entityId={snapshot.id}
          version={snapshot.version}
          onClose={() => setSnapshot(null)}
        />
      )}
    </div>
  );
}

function EntityList({
  tabConfig,
  selectedId,
  onSelect,
}: {
  tabConfig: typeof TABS[number];
  selectedId: string | null;
  onSelect: (id: string, name: string) => void;
}) {
  const { data, error } = useSWR<any>(tabConfig.listEndpoint);
  // Endpoints differ: paginated wrappers return { data: [...] }; equipment-groups list returns the array directly.
  const items: any[] = Array.isArray(data) ? data : (data?.data ?? []);

  if (error) {
    return (
      <div className="bg-white rounded-2xl border-2 border-red-200 p-4 text-sm text-red-700">
        Failed to load: {error.message}
      </div>
    );
  }
  if (!data) {
    return (
      <div className="bg-white rounded-2xl border-2 border-slate-200 p-4 text-sm text-slate-400">Loading…</div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="bg-white rounded-2xl border-2 border-slate-200 p-4 text-sm text-slate-400">
        No {tabConfig.label.toLowerCase()} yet.
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border-2 border-slate-200 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide font-semibold text-slate-500">
        {items.length} {tabConfig.label}
      </div>
      <div className="divide-y divide-slate-100 max-h-[32rem] overflow-y-auto">
        {items.map(it => (
          <button
            key={it.id}
            onClick={() => onSelect(it.id, it.name ?? it.id)}
            className={`w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors ${
              selectedId === it.id ? 'bg-indigo-50 border-l-2 border-indigo-500' : ''
            }`}
          >
            <div className="text-sm font-medium text-slate-800">{tabConfig.itemLabel(it)}</div>
            {it.description && <div className="text-xs text-slate-500 mt-0.5 truncate">{it.description}</div>}
          </button>
        ))}
      </div>
    </div>
  );
}

function VersionTimeline({
  kind,
  entityId,
  entityName,
  onPickVersion,
}: {
  kind: EntityKind;
  entityId: string;
  entityName: string;
  onPickVersion: (v: number) => void;
}) {
  const { data, error } = useSWR<any>(versionsEndpoint(kind, entityId));

  if (error) {
    return <div className="text-sm text-red-700">Failed to load versions: {error.message}</div>;
  }
  if (!data) {
    return <div className="text-sm text-slate-400">Loading version history…</div>;
  }

  // Endpoint shapes vary slightly across the four entities:
  //   cleaning-profile (A.2): { lineageId, versions: [...] }
  //   filter-profile  (A.3): { profileId, currentVersion, versions: [...] }
  //   checklist-profile (A.1): array of versions directly
  //   equipment-group (A.4): { groupId, currentVersion, versions: [...] }
  const versions: any[] = Array.isArray(data) ? data : (data.versions ?? []);
  const currentVersion: number | undefined = data.currentVersion;
  const lineageInfo: string | undefined = data.lineageId ? `Lineage ${data.lineageId.slice(0, 8)}…` : undefined;

  return (
    <div>
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">{entityName}</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {currentVersion !== undefined && <>Current version <strong>v{currentVersion}</strong> · </>}
            {versions.length} archived version{versions.length === 1 ? '' : 's'}
            {lineageInfo && <> · {lineageInfo}</>}
          </p>
        </div>
      </div>

      {versions.length === 0 ? (
        <div className="text-sm text-slate-400 py-8 text-center">
          No archived versions yet. The first version is created lazily on first edit — the live row IS v1 until then.
        </div>
      ) : (
        <ol className="relative border-l-2 border-slate-200 ml-3 space-y-4">
          {versions.map(v => {
            const versionNumber: number = v.versionNumber ?? v.version;
            return (
              <li key={`${v.id ?? versionNumber}`} className="ml-4">
                <span className="absolute -left-2 w-4 h-4 rounded-full bg-indigo-500 border-2 border-white" />
                <button
                  onClick={() => onPickVersion(versionNumber)}
                  className="w-full text-left bg-slate-50 hover:bg-indigo-50 border border-slate-200 hover:border-indigo-300 rounded-xl px-4 py-3 transition-colors"
                >
                  <div className="flex items-baseline gap-3">
                    <span className="text-sm font-semibold text-slate-800">v{versionNumber}</span>
                    {v.changeNotes && <span className="text-xs text-slate-500">— {v.changeNotes}</span>}
                  </div>
                  <div className="text-xs text-slate-400 mt-1">
                    {v.createdAt && <>Archived {new Date(v.createdAt).toLocaleString()}</>}
                    {v.createdBy && <> · by {v.createdBy.slice(0, 8)}…</>}
                  </div>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function SnapshotModal({
  kind,
  entityId,
  version,
  onClose,
}: {
  kind: EntityKind;
  entityId: string;
  version: number;
  onClose: () => void;
}) {
  const { data, error } = useSWR<any>(snapshotEndpoint(kind, entityId, version));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl border-2 border-slate-200 shadow-2xl max-w-3xl w-full max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h3 className="font-semibold text-slate-800">Frozen snapshot · v{version}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl leading-none">×</button>
        </div>
        <div className="px-6 py-4 overflow-y-auto flex-1">
          {error && <div className="text-sm text-red-700">Failed to load snapshot: {error.message}</div>}
          {!data && !error && <div className="text-sm text-slate-400">Loading…</div>}
          {data && (
            <pre className="text-xs bg-slate-50 border border-slate-200 rounded-xl p-4 overflow-x-auto whitespace-pre-wrap break-words">
              {JSON.stringify(data, null, 2)}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
