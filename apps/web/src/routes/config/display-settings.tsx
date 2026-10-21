import { useState } from 'react';
import { FieldIdsPage } from './field-ids';
import { AuditTemplatesConfigPage } from './audit-templates';
import { PaginationConfigPage } from './pagination';
import { PageHeader } from '@/components/ui/page-header';

/**
 * Display Settings — one SUPER_ADMIN page combining Field ID Names, Audit Text
 * Templates, and Pagination Settings into tabs. Each tab is an independent
 * editor backed by its own config key (field-ids / audit-templates / pagination)
 * and keeps its own Save. Replaces the three standalone pages (2026-06-29).
 */
type TabKey = 'fields' | 'audit' | 'pagination';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'fields', label: 'Field IDs' },
  { key: 'audit', label: 'Audit Text' },
  { key: 'pagination', label: 'Pagination' },
];

export function DisplaySettingsPage() {
  const [tab, setTab] = useState<TabKey>('fields');

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <PageHeader
        title="Display Settings"
        subtitle="Field display names, audit-trail wording, and list page sizes."
        icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M4 6h16M4 12h16M4 18h10" />}
      />

      {/* Tab bar */}
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1 w-full sm:w-fit">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-1 sm:flex-none px-5 py-2 rounded-lg text-sm font-semibold transition-all ${
              tab === t.key ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Active panel */}
      <div>
        {tab === 'fields' && <FieldIdsPage />}
        {tab === 'audit' && <AuditTemplatesConfigPage />}
        {tab === 'pagination' && <PaginationConfigPage />}
      </div>
    </div>
  );
}
