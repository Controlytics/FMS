// Export "surfaces" = the pages/reports that offer a PDF / Excel download.
// Used by the role-wise Export Options config (per-page x per-role) and by the
// <ExportMenu> gating hook. Keep this list in sync with the pages that render
// an <ExportMenu>.
export type ExportFormat = 'NONE' | 'PDF' | 'EXCEL' | 'BOTH';

export interface ExportSurface {
  key: string;
  label: string;
}

export const EXPORT_SURFACES: ExportSurface[] = [
  { key: 'filters', label: 'Filters' },
  { key: 'audit', label: 'Audit Trail' },
  { key: 'cleaning-record', label: 'Filter Cleaning Record' },
  { key: 'cleaning-detail', label: 'Cleaning Cycle Detail' },
  { key: 'lifecycle', label: 'Cleaning Lifecycle Report' },
  { key: 'deviations', label: 'Deviations' },
  { key: 'replacement', label: 'Replacement Schedule' },
  { key: 'rfid-track-record', label: 'RFID Track Record' },
  { key: 'pm', label: 'PM Schedules' },
  { key: 'qnn', label: 'Quality Notifications (QNN)' },
  // OQ-16 (2026-10-19): these two pages had their own Export buttons and never
  // joined the matrix, so "PDF only" still offered them Excel. Not to be
  // confused with 'replacement' above, which is the Replacement SCHEDULE.
  { key: 'retirement-list', label: 'Retirement List' },
  { key: 'replacement-list', label: 'Replacement List' },
];

/** Resolve a stored format string into PDF/Excel button visibility.
 *  Fail-open: anything unrecognised (incl. undefined) -> both shown. */
export function formatToFlags(fmt: string | undefined | null): { pdf: boolean; excel: boolean } {
  switch (fmt) {
    case 'NONE': return { pdf: false, excel: false };
    case 'PDF': return { pdf: true, excel: false };
    case 'EXCEL': return { pdf: false, excel: true };
    case 'BOTH':
    default: return { pdf: true, excel: true };
  }
}
