import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { EXPORT_SURFACES, formatToFlags } from '../export-surfaces';
import { REPORT_TYPES } from '../report-types';
import { REPORT_DEFS, resolveReportLabels } from '../report-labels';
import { ALL_ROWS } from '../page-size';

/**
 * Three registries that config pages render and report pages key into:
 *  - EXPORT_SURFACES -> Config "Export Options" matrix + <ExportMenu surface=...>
 *  - REPORT_TYPES    -> Config "Report Signatories" rows + createReport({ reportKey })
 *  - REPORT_DEFS     -> Config "Report Labels" editor + useReportLabels().labelsFor(key)
 * A key a page uses but the registry lacks is a page the admin cannot configure,
 * so the guards below read the real page sources.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, '../..');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === '__tests__' || name === 'test-utils') continue;
      out.push(...sourceFiles(p));
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}
const allSource = sourceFiles(SRC).map((f) => readFileSync(f, 'utf8')).join('\n');
const used = (re: RegExp) => [...new Set([...allSource.matchAll(re)].map((m) => m[1]))].sort();

describe('formatToFlags (fail-open)', () => {
  it.each([
    ['NONE', { pdf: false, excel: false }],
    ['PDF', { pdf: true, excel: false }],
    ['EXCEL', { pdf: false, excel: true }],
    ['BOTH', { pdf: true, excel: true }],
    [undefined, { pdf: true, excel: true }],
    [null, { pdf: true, excel: true }],
    ['', { pdf: true, excel: true }],
    ['pdf', { pdf: true, excel: true }], // case matters: lower-case is unrecognised -> both
    ['GARBAGE', { pdf: true, excel: true }],
  ])('%s -> %o', (fmt, flags) => {
    expect(formatToFlags(fmt as string | undefined | null)).toEqual(flags);
  });
});

describe('EXPORT_SURFACES', () => {
  it('has unique keys and a label for each', () => {
    const keys = EXPORT_SURFACES.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(EXPORT_SURFACES.every((s) => s.label.trim().length > 0)).toBe(true);
  });

  it('lists every surface an <ExportMenu> is rendered with (else "PDF only" never applies there)', () => {
    const surfaces = used(/<ExportMenu[\s\S]{0,400}?surface="([a-z-]+)"/g);
    expect(surfaces.length).toBeGreaterThan(5);
    const registered = new Set(EXPORT_SURFACES.map((s) => s.key));
    expect(surfaces.filter((k) => !registered.has(k))).toEqual([]);
  });
});

describe('REPORT_TYPES', () => {
  it('has unique keys and a label for each', () => {
    const keys = REPORT_TYPES.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(REPORT_TYPES.every((r) => r.label.trim().length > 0)).toBe(true);
  });

  it('lists every reportKey a page passes to createReport (else its signature label cannot be configured)', () => {
    const keys = used(/reportKey:\s*'([a-z-]+)'/g);
    expect(keys.length).toBeGreaterThan(5);
    const registered = new Set(REPORT_TYPES.map((r) => r.key));
    expect(keys.filter((k) => !registered.has(k))).toEqual([]);
  });

  it('offers a Report Signatories row for the Retirement List and Replacement List PDFs (D-UI-2)', () => {
    expect(REPORT_TYPES).toEqual(expect.arrayContaining([
      { key: 'replacement-list', label: 'Replacement List' },
      { key: 'retirement-list', label: 'Retirement List' },
    ]));
  });
});

describe('REPORT_DEFS / resolveReportLabels', () => {
  it('has unique report keys and unique column keys per report', () => {
    const keys = REPORT_DEFS.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const d of REPORT_DEFS) {
      const cols = d.columns.map((c) => c.key);
      expect(new Set(cols).size, d.key).toBe(cols.length);
    }
  });

  it('defines every report a page asks labelsFor()', () => {
    const asked = used(/labelsFor\('([a-z-]+)'\)/g);
    expect(asked.length).toBeGreaterThan(3);
    const defined = new Set(REPORT_DEFS.map((d) => d.key));
    expect(asked.filter((k) => !defined.has(k))).toEqual([]);
  });

  it('with no config returns the built-in title, empty subtitle and default column labels', () => {
    const r = resolveReportLabels('cleaning-cycles', undefined);
    expect(r.title).toBe('Filter Cleaning Record');
    expect(r.subtitle).toBe('');
    expect(r.columns.sNo).toBe('S.No');
    expect(r.columns.dryBy).toBe('Dry By');
    expect(r.orderedLabels()).toEqual(REPORT_DEFS.find((d) => d.key === 'cleaning-cycles')!.columns.map((c) => c.default));
  });

  it('applies trimmed overrides and ignores blank ones', () => {
    const r = resolveReportLabels('audit-trail', {
      'audit-trail': {
        title: '  System Audit  ',
        subtitle: ' Q3 ',
        columns: { action: '  Event ', user: '   ', ipAddress: '' },
      },
    });
    expect(r.title).toBe('System Audit');
    expect(r.subtitle).toBe('Q3');
    expect(r.columns.action).toBe('Event');
    expect(r.columns.user).toBe('User');           // whitespace override -> default
    expect(r.columns.ipAddress).toBe('IP Address'); // empty override -> default
  });

  it('a blank title override keeps the default title', () => {
    expect(resolveReportLabels('audit-trail', { 'audit-trail': { title: '   ' } }).title).toBe('Audit Trail');
  });

  it('another report\'s override does not leak in', () => {
    const r = resolveReportLabels('audit-trail', { 'rfid-track-record': { title: 'X', columns: { user: 'Y' } } });
    expect(r.title).toBe('Audit Trail');
    expect(r.columns.user).toBe('User');
  });

  it('orderedLabels(keys) follows the caller order and echoes an unknown key back', () => {
    const r = resolveReportLabels('audit-trail', { 'audit-trail': { columns: { user: 'Operator' } } });
    expect(r.orderedLabels(['user', 'timestamp', 'nope'])).toEqual(['Operator', 'Timestamp', 'nope']);
  });

  it('an unknown report key resolves to the key itself with no columns', () => {
    const r = resolveReportLabels('no-such-report', {});
    expect(r.title).toBe('no-such-report');
    expect(r.columns).toEqual({});
    expect(r.orderedLabels()).toEqual([]);
    expect(r.orderedLabels(['a'])).toEqual(['a']);
    expect(resolveReportLabels('no-such-report', { 'no-such-report': { title: 'Custom' } }).title).toBe('Custom');
  });
});

describe('ALL_ROWS', () => {
  it('is the explicit "every row" page size (no record caps)', () => {
    expect(ALL_ROWS).toBe(1_000_000);
    expect(Number.isSafeInteger(ALL_ROWS)).toBe(true);
  });
});
