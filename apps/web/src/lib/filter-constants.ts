/** Shared cleaning stage definitions used across filter-operations, filter-status, and cleaning-profile-editor */
export const CLEANING_STAGES = [
  { key: 'WASH_IN', label: 'Wash In', color: 'blue' },
  { key: 'WASH_OUT', label: 'Wash Out', color: 'cyan' },
  { key: 'DRY_IN', label: 'Dry In', color: 'amber' },
  { key: 'DRY_OUT', label: 'Dry Out', color: 'orange' },
  { key: 'STORAGE_IN', label: 'Storage In', color: 'green' },
  { key: 'STORAGE_OUT', label: 'Storage Out', color: 'emerald' },
];

/** UI-enriched stage definitions for the filter operations page */
export const CLEANING_STAGES_OPS = [
  { key: 'WASH_IN', label: 'Wash In', icon: '\ud83d\udebf', color: 'from-sky-600 to-sky-700', border: 'border-sky-600', activeBg: 'bg-sky-50', needsBlock: true },
  { key: 'WASH_OUT', label: 'Wash Out', icon: '\ud83d\udca7', color: 'from-sky-600 to-sky-800', border: 'border-sky-500', activeBg: 'bg-sky-50', needsBlock: false },
  { key: 'DRY_IN', label: 'Dry In', icon: '\ud83c\udf21\ufe0f', color: 'from-amber-600 to-amber-700', border: 'border-amber-600', activeBg: 'bg-amber-50', needsBlock: true },
  { key: 'DRY_OUT', label: 'Dry Out', icon: '\u2600\ufe0f', color: 'from-amber-600 to-amber-800', border: 'border-amber-500', activeBg: 'bg-amber-50', needsBlock: false },
  { key: 'STORAGE_IN', label: 'Storage In', icon: '\ud83d\udce5', color: 'from-slate-500 to-slate-600', border: 'border-slate-400', activeBg: 'bg-slate-50', needsBlock: false },
  { key: 'STORAGE_OUT', label: 'Storage Out', icon: '\ud83d\udce4', color: 'from-slate-500 to-slate-700', border: 'border-slate-300', activeBg: 'bg-slate-50', needsBlock: false },
];

/** Stage definitions for filter-status page */
export const CLEANING_STAGES_STATUS = [
  { key: 'WASH_IN', label: 'Wash In', icon: '\ud83d\udebf', color: 'from-sky-600 to-sky-700', border: 'border-sky-600', activeBg: 'bg-sky-50' },
  { key: 'WASH_OUT', label: 'Wash Out', icon: '\ud83d\udca7', color: 'from-sky-600 to-sky-800', border: 'border-sky-500', activeBg: 'bg-sky-50' },
  { key: 'DRY_IN', label: 'Dry In', icon: '\ud83c\udf21\ufe0f', color: 'from-amber-600 to-amber-700', border: 'border-amber-600', activeBg: 'bg-amber-50' },
  { key: 'DRY_OUT', label: 'Dry Out', icon: '\u2600\ufe0f', color: 'from-amber-600 to-amber-800', border: 'border-amber-500', activeBg: 'bg-amber-50' },
  { key: 'STORAGE_IN', label: 'Storage In', icon: '\ud83d\udce5', color: 'from-slate-500 to-slate-600', border: 'border-slate-400', activeBg: 'bg-slate-50' },
  { key: 'STORAGE_OUT', label: 'Storage Out', icon: '\ud83d\udce4', color: 'from-slate-500 to-slate-700', border: 'border-slate-300', activeBg: 'bg-slate-50' },
];

/** Stage definitions for the cleaning-profile-editor canvas sidebar */
export const CLEANING_STAGES_EDITOR = [
  { key: 'WASH_IN',     name: 'Wash In',     color: '#3B8BD4' },
  { key: 'WASH_OUT',    name: 'Wash Out',    color: '#3B8BD4' },
  { key: 'DRY_IN',      name: 'Dry In',      color: '#EF9F27' },
  { key: 'DRY_OUT',     name: 'Dry Out',     color: '#EF9F27' },
  { key: 'STORAGE_IN',  name: 'Storage In',  color: '#888780' },
  { key: 'STORAGE_OUT', name: 'Storage Out', color: '#888780' },
];

export const FILTER_STATE_COLORS: Record<string, string> = {
  INSTALLED: 'bg-blue-500',
  WASH_IN: 'bg-sky-500',
  WASH_OUT: 'bg-sky-400',
  DRY_IN: 'bg-amber-500',
  DRY_OUT: 'bg-amber-400',
  STORAGE_IN: 'bg-slate-400',
  STORAGE_OUT: 'bg-slate-300',
  IN_USE: 'bg-emerald-500',
  RETIRED: 'bg-red-500',
};
