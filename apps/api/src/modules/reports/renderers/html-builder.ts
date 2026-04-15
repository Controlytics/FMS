import dayjs from 'dayjs';
import { PDF_STYLES } from './styles.js';
import { renderChart } from './chart-renderer.js';
import { substituteString } from '../variable-resolver.js';

interface ConditionalRule {
  condition: string;
  value?: string | number;
  min?: number;
  max?: number;
  style: Record<string, string>;
}

function applyConditionalStyle(value: unknown, rules?: ConditionalRule[]): string {
  if (!rules || rules.length === 0) return '';
  const num = typeof value === 'number' ? value : Number(value);
  const str = String(value ?? '');

  for (const rule of rules) {
    let match = false;
    switch (rule.condition) {
      case 'gt': match = !isNaN(num) && num > Number(rule.value); break;
      case 'gte': match = !isNaN(num) && num >= Number(rule.value); break;
      case 'lt': match = !isNaN(num) && num < Number(rule.value); break;
      case 'lte': match = !isNaN(num) && num <= Number(rule.value); break;
      case 'eq': match = str === String(rule.value); break;
      case 'neq': match = str !== String(rule.value); break;
      case 'between': match = !isNaN(num) && num >= Number(rule.min) && num <= Number(rule.max); break;
      case 'contains': match = str.includes(String(rule.value)); break;
      case 'empty': match = str === '' || value === null || value === undefined; break;
      case 'not_empty': match = str !== '' && value !== null && value !== undefined; break;
    }
    if (match) {
      const styles: string[] = [];
      if (rule.style.fontWeight) styles.push(`font-weight:${rule.style.fontWeight}`);
      if (rule.style.fontStyle) styles.push(`font-style:${rule.style.fontStyle}`);
      if (rule.style.color) styles.push(`color:${rule.style.color}`);
      if (rule.style.backgroundColor) styles.push(`background-color:${rule.style.backgroundColor}`);
      if (rule.style.textDecoration) styles.push(`text-decoration:${rule.style.textDecoration}`);
      return styles.join(';');
    }
  }
  return '';
}

function formatValue(value: unknown, format?: { type: string; decimalPlaces?: number; unit?: string; pattern?: string }): string {
  if (value === null || value === undefined) return '\u2014';
  if (!format || format.type === 'text') return String(value);

  if (format.type === 'number') {
    const num = Number(value);
    if (isNaN(num)) return String(value);
    const formatted = format.decimalPlaces !== undefined ? num.toFixed(format.decimalPlaces) : String(num);
    return format.unit ? `${formatted} ${format.unit}` : formatted;
  }

  if (format.type === 'datetime') {
    return dayjs(value as string).format(format.pattern || 'DD/MM/YYYY HH:mm');
  }

  return String(value);
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderHeaderFooter(config: { enabled: boolean; elements: any[] }, resolved: Map<string, unknown>): string {
  if (!config.enabled || config.elements.length === 0) return '';
  const positions: Record<string, string[]> = { left: [], center: [], right: [] };

  for (const el of config.elements) {
    const pos = el.position || 'left';
    if (el.type === 'text') {
      const text = substituteString(el.content ?? '', resolved);
      const style = el.style ? `font-size:${el.style.fontSize ?? 10}pt;${el.style.fontWeight ? `font-weight:${el.style.fontWeight}` : ''}${el.style.color ? `;color:${el.style.color}` : ''}` : '';
      positions[pos].push(`<span style="${style}">${escapeHtml(text)}</span>`);
    } else if (el.type === 'image') {
      positions[pos].push(`<span style="font-size:14pt;font-weight:bold;color:#0891b2;">&#9632; Report</span>`);
    }
  }

  return `<div class="report-header">
    <div class="left">${positions.left.join('')}</div>
    <div class="center">${positions.center.join('')}</div>
    <div class="right">${positions.right.join('')}</div>
  </div>`;
}

function renderTableSection(section: any, resolved: Map<string, unknown>): string {
  let rows: any[] = [];

  // Find resolved data for this table's data source
  const tagMatch = (section.dataSource ?? '').match(/\{\{([^}]+)\}\}/);
  if (tagMatch) {
    const val = resolved.get(tagMatch[1]);
    if (Array.isArray(val)) rows = val;
  }

  const settings = section.tableSettings ?? {};
  const classes = ['data-table'];
  if (!settings.showBorders) classes.push('no-borders');
  if (!settings.stripedRows) classes.push('no-stripes');

  let html = `<div class="section">`;
  if (section.title) html += `<div class="section-title">${escapeHtml(section.title)}</div>`;
  html += `<table class="${classes.join(' ')}" style="font-size:${settings.bodyStyle?.fontSize ?? 10}pt;font-family:${settings.bodyStyle?.fontFamily ?? 'Arial'}">`;

  if (section.columns?.length > 0) {
    html += '<thead><tr>';
    for (const col of section.columns) {
      const style = col.width ? `width:${col.width};` : '';
      const align = col.style?.textAlign ? `text-align:${col.style.textAlign};` : '';
      html += `<th style="${style}${align}">${escapeHtml(col.header || col.key)}</th>`;
    }
    html += '</tr></thead>';
  }

  html += '<tbody>';
  const maxRows = settings.maxRowsPerPage ?? 200;
  const displayRows = rows.slice(0, maxRows);

  for (const row of displayRows) {
    html += '<tr>';
    for (const col of (section.columns ?? [])) {
      const rawValue = row[col.key] ?? row.value ?? '';
      const formatted = formatValue(rawValue, col.format);
      const condStyle = applyConditionalStyle(rawValue, col.conditionalRules);
      const align = col.style?.textAlign ? `text-align:${col.style.textAlign};` : '';
      const transform = col.style?.textTransform && col.style.textTransform !== 'none' ? `text-transform:${col.style.textTransform};` : '';
      html += `<td style="${align}${transform}${condStyle}">${escapeHtml(formatted)}</td>`;
    }
    html += '</tr>';
  }
  html += '</tbody></table>';

  if (rows.length > maxRows) {
    html += `<div style="font-size:8pt;color:#94a3b8;margin-top:4px;">Showing ${maxRows} of ${rows.length} rows</div>`;
  }
  html += '</div>';
  return html;
}

function renderKVSection(section: any, resolved: Map<string, unknown>): string {
  const layoutClass = section.layout === 'three_column' ? 'cols-3' : section.layout === 'two_column' ? 'cols-2' : 'cols-1';
  let html = `<div class="section">`;
  if (section.title) html += `<div class="section-title">${escapeHtml(section.title)}</div>`;
  html += `<div class="kv-grid ${layoutClass}">`;

  for (const entry of (section.entries ?? [])) {
    const value = substituteString(entry.value ?? '', resolved);
    const formatted = formatValue(value, entry.format);
    html += `<div class="kv-entry"><span class="kv-label">${escapeHtml(entry.label)}</span><span class="kv-value">${escapeHtml(formatted)}</span></div>`;
  }

  html += '</div></div>';
  return html;
}

function renderSignatureSection(section: any, signatureConfig: any): string {
  let html = `<div class="signature-block section">`;
  if (section.label) html += `<div class="section-title">${escapeHtml(section.label)}</div>`;
  if (signatureConfig.meaning) html += `<div style="font-size:9pt;color:#475569;margin-bottom:12px;font-style:italic;">"${escapeHtml(signatureConfig.meaning)}"</div>`;
  html += '<div class="signature-row">';

  const signerRoles = section.signers ?? [];
  const signerDefs = signatureConfig.signers ?? [];

  for (const role of signerRoles) {
    const def = signerDefs.find((s: any) => s.role === role);
    const label = def?.label || role;
    html += `<div class="signature-slot">
      <div class="sig-label">${escapeHtml(label)}</div>
      <div class="sig-name" style="margin-top:30px;">Name: ___________________</div>
      <div class="sig-date">Date: ___________________</div>
    </div>`;
  }

  html += '</div></div>';
  return html;
}

export async function buildHtml(
  config: any,
  resolved: Map<string, unknown>,
): Promise<string> {
  const sectionsHtml: string[] = [];

  for (const section of (config.sections ?? [])) {
    switch (section.type) {
      case 'text': {
        const content = substituteString(section.content ?? '', resolved);
        const style = `font-size:${section.style?.fontSize ?? 12}pt;font-family:${section.style?.fontFamily ?? 'Arial'};line-height:${section.style?.lineHeight ?? 1.5}`;
        sectionsHtml.push(`<div class="section text-section" style="${style}">${escapeHtml(content)}</div>`);
        break;
      }
      case 'table':
        sectionsHtml.push(renderTableSection(section, resolved));
        break;
      case 'chart': {
        const seriesData = new Map<string, unknown>();
        for (const series of (section.dataSeries ?? [])) {
          const tagContent = series.source.replace(/\{\{|\}\}/g, '');
          for (const [tag, val] of resolved) {
            if (tag === tagContent || series.source.includes(tag)) {
              seriesData.set(series.source, val);
            }
          }
        }
        const chartImg = await renderChart(section, seriesData);
        sectionsHtml.push(`<div class="section chart-section">${section.title ? `<div class="section-title">${escapeHtml(section.title)}</div>` : ''}<img src="${chartImg}" style="max-width:100%;height:${section.height}px;" /></div>`);
        break;
      }
      case 'key_value':
        sectionsHtml.push(renderKVSection(section, resolved));
        break;
      case 'signature':
        sectionsHtml.push(renderSignatureSection(section, config.signatureConfig ?? {}));
        break;
      case 'page_break':
        sectionsHtml.push('<div class="page-break"></div>');
        break;
    }
  }

  const headerHtml = renderHeaderFooter(config.header ?? { enabled: false, elements: [] }, resolved);
  const footerHtml = renderHeaderFooter(config.footer ?? { enabled: false, elements: [] }, resolved);

  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<style>${PDF_STYLES}</style>
</head><body>
${headerHtml}
${sectionsHtml.join('\n')}
${footerHtml}
</body></html>`;
}
