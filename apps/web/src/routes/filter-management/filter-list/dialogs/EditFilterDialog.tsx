import type { FilterFieldOptions, LastCleaningDateState } from '../types';
import { FilterFieldOptionsSection } from '../components/FilterFieldOptionsSection';

/**
 * SUPER_ADMIN extension (2026-09-05, operator request): the same dialog also
 * edits Area / AHU, the cleaning Status, the RFID tag, and takes a mandatory
 * change reason. The page decides whether to pass `superAdmin`; when it is
 * absent the dialog is exactly the FILTER_EDIT dialog it always was.
 */
export type EditFilterSuperAdminProps = {
  /** Hidden for a retired filter (its AHU link is torn down on retire). */
  showHierarchy: boolean;
  areaOptions: Array<{ id: string; name: string }>;
  ahuOptions: Array<{ id: string; name: string }>;
  areaId: string;
  ahuId: string;
  onAreaChange: (v: string) => void;
  onAhuChange: (v: string) => void;
  lifecycleOptions: Array<{ value: string; label: string }>;
  lifecycleState: string;
  /** The stored state, so the cleaning-reason picker appears only on a change. */
  currentLifecycleState: string;
  onLifecycleChange: (v: string) => void;
  cleaningReasons: Array<{ key: string; name: string }>;
  cleaningReasonKey: string;
  onCleaningReasonChange: (v: string) => void;
  rfid: string;
  onRfidChange: (v: string) => void;
  reason: string;
  onReasonChange: (v: string) => void;
  onClearFilterSet: () => void;
};

type Props = {
  name: string;
  /** '' = this filter has no set assigned; neither button is highlighted. */
  filterSet: 'A' | 'B' | '';
  error: string;
  submitting: boolean;
  fieldOptions: FilterFieldOptions;
  ahuType: string;
  filterType: string;
  micronSize: string;
  filterSize: string;
  lastCleaning: LastCleaningDateState;
  onNameChange: (v: string) => void;
  onFilterSetChange: (v: 'A' | 'B') => void;
  onAhuTypeChange: (v: string) => void;
  onFilterTypeChange: (v: string) => void;
  onMicronSizeChange: (v: string) => void;
  onFilterSizeChange: (v: string) => void;
  onLastCleaningChange: (s: LastCleaningDateState) => void;
  onClose: () => void;
  onSubmit: () => void;
  superAdmin?: EditFilterSuperAdminProps;
};

const selectCls = 'w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-amber-500 focus:border-amber-500';

export function EditFilterDialog({
  name, filterSet, error, submitting,
  fieldOptions, ahuType, filterType, micronSize, filterSize, lastCleaning,
  onNameChange, onFilterSetChange,
  onAhuTypeChange, onFilterTypeChange, onMicronSizeChange, onFilterSizeChange, onLastCleaningChange,
  onClose, onSubmit, superAdmin,
}: Props) {
  const sa = superAdmin;
  const reasonOk = !sa || sa.reason.trim().length >= 5;
  const lifecycleChanged = !!sa && sa.lifecycleState !== sa.currentLifecycleState;
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[55] p-4">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md overflow-hidden flex flex-col shadow-2xl">
        <div className="px-6 py-4 shrink-0 flex items-center justify-between bg-gradient-to-r from-amber-500 to-orange-500">
          <div>
            <h2 className="text-lg font-bold text-white">{sa ? 'Edit Filter (Super Admin)' : 'Edit Filter'}</h2>
            <p className="text-white/70 text-sm">{sa ? 'Every field - written to the database and recorded in the audit trail' : 'Update filter name, set, and field details'}</p>
          </div>
          <button onClick={onClose} className="text-white/80 hover:text-white">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="px-6 py-5 space-y-4 overflow-y-auto" style={{ maxHeight: 'calc(90vh - 160px)' }}>
          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>
          )}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Filter Name <span className="text-red-500">*</span></label>
            <input type="text" value={name} onChange={e => onNameChange(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500" />
          </div>

          {sa && sa.showHierarchy && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Area</label>
                <select value={sa.areaId} onChange={e => sa.onAreaChange(e.target.value)} className={selectCls}>
                  <option value="">All areas / no area</option>
                  {sa.areaOptions.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">AHU <span className="text-red-500">*</span></label>
                <select value={sa.ahuId} onChange={e => sa.onAhuChange(e.target.value)} className={selectCls}>
                  <option value="">-- select AHU --</option>
                  {sa.ahuOptions.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Filter Set</label>
            <div className="flex gap-2">
              {(['A', 'B'] as const).map(s => (
                <button key={s} type="button" onClick={() => onFilterSetChange(s)}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm font-semibold border transition-colors ${
                    filterSet === s ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                  }`}>
                  Set {s}
                </button>
              ))}
              {sa && (
                <button type="button" onClick={sa.onClearFilterSet}
                  className={`px-3 py-2 rounded-lg text-sm font-semibold border transition-colors ${
                    filterSet === '' ? 'bg-slate-600 text-white border-slate-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                  }`}>
                  None
                </button>
              )}
            </div>
          </div>

          <FilterFieldOptionsSection
            options={fieldOptions}
            ahuType={ahuType}
            filterType={filterType}
            micronSize={micronSize}
            filterSize={filterSize}
            lastCleaning={lastCleaning}
            onAhuTypeChange={onAhuTypeChange}
            onFilterTypeChange={onFilterTypeChange}
            onMicronSizeChange={onMicronSizeChange}
            onFilterSizeChange={onFilterSizeChange}
            onLastCleaningChange={onLastCleaningChange}
          />

          {sa && (
            <>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
                <select value={sa.lifecycleState} onChange={e => sa.onLifecycleChange(e.target.value)} className={selectCls}>
                  <option value="">-- no cleaning status --</option>
                  {sa.lifecycleOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <p className="mt-1 text-[11px] text-slate-500">Goes through the same rules as Update Status: the cleaning-profile sequence is enforced and a move that starts a cycle needs a cleaning reason.</p>
              </div>
              {lifecycleChanged && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Cleaning reason (if this move starts a cycle)</label>
                  <select value={sa.cleaningReasonKey} onChange={e => sa.onCleaningReasonChange(e.target.value)} className={selectCls}>
                    <option value="">-- none --</option>
                    {sa.cleaningReasons.map(r => <option key={r.key} value={r.key}>{r.name}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">RFID tag</label>
                <input type="text" value={sa.rfid} onChange={e => sa.onRfidChange(e.target.value)} placeholder="Blank = no tag"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono focus:ring-2 focus:ring-amber-500 focus:border-amber-500" />
                <p className="mt-1 text-[11px] text-slate-500">Changing it removes the current tag and assigns this one; both steps appear on the RFID Track Record.</p>
              </div>
              <div className="pt-3 border-t border-slate-200">
                <label className="block text-sm font-medium text-slate-700 mb-1">Reason for this change <span className="text-red-500">*</span></label>
                <textarea value={sa.reason} onChange={e => sa.onReasonChange(e.target.value)} rows={2} placeholder="At least 5 characters - recorded on the audit row"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500" />
              </div>
            </>
          )}
        </div>
        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center gap-3">
          <button onClick={onClose} className="flex-1 px-4 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors">Cancel</button>
          <button onClick={onSubmit} disabled={submitting || !name.trim() || !reasonOk || (!!sa && sa.showHierarchy && !sa.ahuId)}
            title={!reasonOk ? 'Enter a reason of at least 5 characters' : undefined}
            className="flex-1 px-4 py-2 rounded-lg text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
            {submitting ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
