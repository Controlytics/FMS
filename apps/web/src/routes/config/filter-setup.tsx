import { useState } from 'react';
import { CleaningProfileAssignmentPage } from './cleaning-profile-assignment';
import { CleaningReasonsConfigPage } from './filter-cleaning-reasons';
import { FilterFieldOptionsConfigPage } from './filter-field-options';
import { PageHeader } from '@/components/ui/page-header';

/**
 * Filter Setup — one SUPER_ADMIN page combining Cleaning Profile Assignment,
 * Filter Cleaning Reasons, and Filter Field Options into tabs. Each tab is an
 * independent editor backed by its own config/endpoint and keeps its own Save.
 * Replaces the three standalone config pages (2026-06-29).
 */
type TabKey = 'assignment' | 'reasons' | 'fields';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'assignment', label: 'Profile Assignment' },
  { key: 'reasons', label: 'Cleaning Reasons' },
  { key: 'fields', label: 'Field Options' },
];

export function FilterSetupPage() {
  const [tab, setTab] = useState<TabKey>('assignment');

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <PageHeader
        title="Filter Setup"
        subtitle="Cleaning-profile assignment rules, cleaning reasons, and filter add/edit dropdown options."
        icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.879a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />}
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
        {tab === 'assignment' && <CleaningProfileAssignmentPage />}
        {tab === 'reasons' && <CleaningReasonsConfigPage />}
        {tab === 'fields' && <FilterFieldOptionsConfigPage />}
      </div>
    </div>
  );
}
