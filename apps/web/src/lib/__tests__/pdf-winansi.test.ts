import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { toWinAnsi, toWinAnsiRows } from '../pdf-winansi';

/**
 * jsPDF's built-in fonts are WinAnsi (cp1252). An unencodable character is not
 * dropped and does not throw — it emits a DIFFERENT glyph, so `Wash Out → Dry
 * In` printed as `Wash Out !` plus junk in a live Filter Lifecycle report.
 *
 * The characters do not only come from our own literals: `audit_trail.reason`
 * holds 143 live rows like `Checklist items: 0 → 1`, all of which render in the
 * Audit Trail PDF. That is why this is applied at the PDF boundary.
 */

/** The authority: what cp1252 can actually encode. */
const encodable = (s: string) => {
  const C1 = new Set([
    0x20AC, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6, 0x2030, 0x0160,
    0x2039, 0x0152, 0x017D, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014,
    0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x017E, 0x0178,
  ]);
  return [...s].every((c) => {
    const n = c.codePointAt(0)!;
    return n <= 0x7F || (n >= 0xA0 && n <= 0xFF) || C1.has(n);
  });
};

describe('toWinAnsi', () => {
  it('transliterates the arrow that actually broke, in code AND in data', () => {
    expect(toWinAnsi('Wash Out → Dry In')).toBe('Wash Out -> Dry In');
    expect(toWinAnsi('Checklist items: 0 → 1')).toBe('Checklist items: 0 -> 1');
  });

  it('keeps meaning rather than blanking the symbol', () => {
    // "0 ? 1" would be worse than the garbled glyph — it reads as data loss.
    expect(toWinAnsi('≤ 7 days')).toBe('<= 7 days');
    expect(toWinAnsi('≥ 30')).toBe('>= 30');
    expect(toWinAnsi('a ≠ b')).toBe('a != b');
    expect(toWinAnsi('A ⇒ B')).toBe('A => B');
    expect(toWinAnsi('done ✓')).toBe('done Y');
  });

  it('leaves every cp1252 character alone', () => {
    // These render correctly and must not be mangled: em/en dash, curly quotes,
    // bullet, ellipsis, middle dot, degree, accented Latin.
    for (const s of ['A — B', 'A – B', '“q” ‘r’', 'a · b', 'x • y', 'more…', '25°C', 'Zürich', '±5']) {
      expect(toWinAnsi(s)).toBe(s);
    }
  });

  it('drops emoji instead of turning them into a row of question marks', () => {
    expect(toWinAnsi('Filter 📊 status')).toBe('Filter  status');
    expect(toWinAnsi('⚠️ warn')).toBe('! warn');
  });

  it('falls back to ? for anything unmapped, so a substitution is visible', () => {
    expect(toWinAnsi('π ω')).toBe('? ?');
  });

  it('output is ALWAYS encodable — the property that matters', () => {
    const samples = [
      'Wash Out → Dry In · enttiiii',
      'Checklist items: 0 → 1',
      'CC-CWH/F1/AHU-0B/SA/05/06-01-011-20260714-M',
      'Period: 01/06/2026 → 03/06/2026',
      '≤ 7 days / 8–30 days / > 30 days',
      'Zürich café — naïve “quote”',
      '📊 ✓ ✗ ⚠️ π',
    ];
    for (const s of samples) {
      expect(encodable(toWinAnsi(s)), `not encodable: ${JSON.stringify(toWinAnsi(s))}`).toBe(true);
    }
  });

  it('is idempotent', () => {
    const once = toWinAnsi('a → b ≤ c ✓');
    expect(toWinAnsi(once)).toBe(once);
  });

  it('handles null, undefined and non-strings without throwing', () => {
    expect(toWinAnsi(null)).toBe('');
    expect(toWinAnsi(undefined)).toBe('');
    expect(toWinAnsi(42)).toBe('42');
  });

  it('maps whole table bodies', () => {
    expect(toWinAnsiRows([['a → b', 'ok'], ['≥ 1', '✓']])).toEqual([['a -> b', 'ok'], ['>= 1', 'Y']]);
  });
});

/**
 * The value of a boundary is that nothing gets past it. These read pdf-report.ts
 * and assert every text entry point is wrapped — a new `doc.text(someValue)`
 * added later is exactly how the arrow reached a live report in the first place.
 *
 * This guard earned its keep immediately: it caught three call sites missed on
 * the first pass, all OPERATOR-CONFIGURABLE text — the branding company name,
 * the branding app name, and the report signatory lines.
 */
describe('pdf-report applies it at every text entry point', () => {
  const src = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../pdf-report.ts'),
    'utf8',
  );
  /** Comments mention doc.text() when explaining it; only real code counts. */
  const codeOnly = src.replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');

  it('routes every doc.text() call through toWinAnsi', () => {
    const unwrapped = [...codeOnly.matchAll(/doc\.text\(([^)]*)/g)]
      .map((m) => m[1].trim())
      .filter((arg) => !arg.includes('toWinAnsi'))
      // String literals are authored here and are already ASCII.
      .filter((arg) => !/^['"`]/.test(arg));
    expect(unwrapped, `unsanitised doc.text() arguments: ${JSON.stringify(unwrapped)}`).toEqual([]);
  });

  it('sanitises both the head and the body of every table', () => {
    expect(codeOnly).toMatch(/head: \[opts\.head\.map\(toWinAnsi\)\]/);
    expect(codeOnly).toMatch(/body: toWinAnsiRows\(opts\.body\)/);
  });

  it('leaves the on-screen snapshot untouched', () => {
    // It renders as HTML, where the real characters are correct — sanitising it
    // would degrade the screen to fix a problem the screen does not have.
    expect(codeOnly).toMatch(/snapSections\.push\(\{ title: pendingTitle, head: opts\.head, body: opts\.body/);
  });
});
