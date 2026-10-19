/**
 * C-07 (2026-10-19): the server's canonical RFID form must equal the tablet /
 * web scan normaliser EXACTLY — a stored value is only findable by a scan if
 * both sides apply the same rule. This runs the web function (imported from
 * the web source tree) against the server copy over the web suite's own cases
 * plus a generated corpus of stuttered / mixed-case / padded values.
 */
import { describe, it, expect } from 'vitest';
import { canonicalRfidValue, sameRfidValue } from '../rfid-canonical.js';
import { normalizeRfidScan } from '../../../../web/src/lib/rfid-scan';

const WEB_CASES: Array<[string | null | undefined, string]> = [
  ['  ca000bf8\r\n', 'CA000BF8'],
  ['\tca000bf8\t', 'CA000BF8'],
  ['CA000BF8CA000BF8', 'CA000BF8'],
  ['CA000BF8CA000BF8CA000BF8', 'CA000BF8'],
  ['CA000BF8', 'CA000BF8'],
  ['ABAB', 'ABAB'],
  ['CWH/AHU-01/01-00', 'CWH/AHU-01/01-00'],
  ['', ''],
  [null, ''],
  [undefined, ''],
];

describe('canonicalRfidValue', () => {
  it.each(WEB_CASES)('%j -> %j (the web suite cases)', (input, expected) => {
    expect(canonicalRfidValue(input)).toBe(expected);
    expect(normalizeRfidScan(input)).toBe(expected);
  });

  it('agrees with the web normaliser on a generated corpus', () => {
    const bases = ['ca000bf8', 'E2801160600002', 'abc', 'abcdef', 'ab12', 'X', 'FD/AHU-02/20-00', 'aBcD1234'];
    const decorate = [
      (s: string) => s,
      (s: string) => s + s,
      (s: string) => s + s + s,
      (s: string) => ` ${s}\r\n`,
      (s: string) => `\t${(s + s).toLowerCase()}\n`,
      (s: string) => s.toUpperCase() + s.toLowerCase(),
    ];
    let checked = 0;
    for (const b of bases) {
      for (const d of decorate) {
        const v = d(b);
        expect(canonicalRfidValue(v)).toBe(normalizeRfidScan(v));
        checked++;
      }
    }
    expect(checked).toBe(bases.length * decorate.length);
  });

  it('sameRfidValue ignores stored casing and stray whitespace', () => {
    expect(sameRfidValue('ca000bf8', 'CA000BF8')).toBe(true);
    expect(sameRfidValue('CA000BF8 ', 'CA000BF8CA000BF8')).toBe(true);
    expect(sameRfidValue('CA000BF9', 'CA000BF8')).toBe(false);
  });
});
