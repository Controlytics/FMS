// ---------------------------------------------------------------------------
// Category colours
// ---------------------------------------------------------------------------

export const CATEGORY_COLORS: Record<string, { bg: string; border: string; text: string; dot: string; light: string }> = {
  INPUT:       { bg: 'bg-blue-600',   border: 'border-blue-400',   text: 'text-blue-100',   dot: 'bg-blue-400',   light: 'bg-blue-50 border-blue-200' },
  FILTER:      { bg: 'bg-amber-500',  border: 'border-amber-400',  text: 'text-amber-100',  dot: 'bg-amber-400',  light: 'bg-amber-50 border-amber-200' },
  ENRICHMENT:  { bg: 'bg-emerald-600',border: 'border-emerald-400',text: 'text-emerald-100',dot: 'bg-emerald-400',light: 'bg-emerald-50 border-emerald-200' },
  TRANSFORM:   { bg: 'bg-purple-600', border: 'border-purple-400', text: 'text-purple-100', dot: 'bg-purple-400', light: 'bg-purple-50 border-purple-200' },
  ACTION:      { bg: 'bg-red-600',    border: 'border-red-400',    text: 'text-red-100',    dot: 'bg-red-400',    light: 'bg-red-50 border-red-200' },
  EXTERNAL:    { bg: 'bg-cyan-600',   border: 'border-cyan-400',   text: 'text-cyan-100',   dot: 'bg-cyan-400',   light: 'bg-cyan-50 border-cyan-200' },
  FLOW:        { bg: 'bg-slate-600',  border: 'border-slate-400',  text: 'text-slate-100',  dot: 'bg-slate-400',  light: 'bg-slate-50 border-slate-200' },
  ANALYTICS:   { bg: 'bg-rose-600',   border: 'border-rose-400',   text: 'text-rose-100',   dot: 'bg-rose-400',   light: 'bg-rose-50 border-rose-200' },
};

export const getCategoryColor = (category: string) =>
  CATEGORY_COLORS[category] ?? CATEGORY_COLORS['FLOW'];

// ---------------------------------------------------------------------------
// Category icons (SVG paths)
// ---------------------------------------------------------------------------

export const CATEGORY_ICONS: Record<string, string> = {
  INPUT:      'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12',
  FILTER:     'M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z',
  ENRICHMENT: 'M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z',
  TRANSFORM:  'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15',
  ACTION:     'M13 10V3L4 14h7v7l9-11h-7z',
  EXTERNAL:   'M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14',
  FLOW:       'M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
  ANALYTICS:  'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
};

export const getCategoryIcon = (category: string) =>
  CATEGORY_ICONS[category] ?? CATEGORY_ICONS['FLOW'];

// ---------------------------------------------------------------------------
// Script node types (show Monaco editor)
// ---------------------------------------------------------------------------

export const SCRIPT_NODE_TYPES = new Set([
  'script-filter',
  'script-transform',
  'script-enrichment',
  'js-filter',
  'js-transform',
  'custom-script',
  'switch',
  'generator',
]);

// Stagger the default node layout on canvas if no position set
export const DEFAULT_POSITION = { x: 200, y: 100 };
