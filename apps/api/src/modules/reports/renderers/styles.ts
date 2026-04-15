export const PDF_STYLES = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 10pt; color: #1e293b; line-height: 1.4; }

  .report-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 0; border-bottom: 2px solid #0891b2; margin-bottom: 16px; }
  .report-header .left { display: flex; align-items: center; gap: 12px; }
  .report-header .center { text-align: center; flex: 1; }
  .report-header .right { text-align: right; font-size: 9pt; color: #64748b; }
  .report-header img { max-height: 50px; }

  .report-footer { display: flex; justify-content: space-between; padding: 8px 0; border-top: 1px solid #cbd5e1; margin-top: 16px; font-size: 8pt; color: #94a3b8; }

  .section { margin-bottom: 20px; break-inside: avoid; }
  .section-title { font-size: 12pt; font-weight: bold; color: #0f172a; margin-bottom: 8px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }

  .text-section { white-space: pre-wrap; }

  table.data-table { width: 100%; border-collapse: collapse; font-size: 9pt; }
  table.data-table thead th { background: #f1f5f9; font-weight: bold; text-transform: uppercase; font-size: 8pt; letter-spacing: 0.5px; padding: 6px 8px; text-align: left; border: 1px solid #cbd5e1; }
  table.data-table tbody td { padding: 5px 8px; border: 1px solid #e2e8f0; }
  table.data-table tbody tr:nth-child(even) { background: #f8fafc; }
  table.data-table.no-borders th, table.data-table.no-borders td { border: none; }
  table.data-table.no-stripes tbody tr:nth-child(even) { background: transparent; }

  .kv-grid { display: grid; gap: 4px 16px; }
  .kv-grid.cols-1 { grid-template-columns: 1fr; }
  .kv-grid.cols-2 { grid-template-columns: 1fr 1fr; }
  .kv-grid.cols-3 { grid-template-columns: 1fr 1fr 1fr; }
  .kv-entry { display: flex; gap: 8px; padding: 3px 0; border-bottom: 1px dotted #e2e8f0; }
  .kv-label { font-weight: 600; color: #475569; min-width: 120px; font-size: 9pt; }
  .kv-value { color: #1e293b; font-size: 9pt; }

  .chart-section { text-align: center; }
  .chart-section img { max-width: 100%; }

  .signature-block { margin-top: 24px; page-break-inside: avoid; }
  .signature-row { display: flex; gap: 40px; margin-top: 16px; }
  .signature-slot { flex: 1; border-top: 1px solid #1e293b; padding-top: 4px; }
  .signature-slot .sig-label { font-size: 9pt; font-weight: 600; }
  .signature-slot .sig-name { font-size: 8pt; color: #64748b; margin-top: 2px; }
  .signature-slot .sig-date { font-size: 8pt; color: #94a3b8; }

  .page-break { page-break-after: always; }
`;
