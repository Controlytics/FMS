import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeRfidScan } from '@/lib/rfid-scan';

/**
 * C-07 (web half) — the Filters page's two RFID WRITE paths stored the typed
 * value with only `.trim()`: the RFID Tag panel's Assign, and the SUPER_ADMIN
 * Edit Filter "RFID" field. Every LOOKUP path normalises through
 * `normalizeRfidScan` (upper-case + doubled/tripled EPC collapse), so a tag
 * assigned as "e200abcd" or "E200ABCDE200ABCD" could never be matched by a scan.
 *
 * Source-level guard: filter-list.tsx is ~2,500 lines wired to ~40 hooks and
 * endpoints and cannot be mounted in isolation (same reason as
 * routes/mobile/__tests__/stage-approvals-single-implementation.test.ts).
 */
const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../filter-list.tsx'), 'utf8');

describe('C-07 — Filters page RFID writes go through normalizeRfidScan', () => {
  it('imports the shared normaliser', () => {
    expect(src).toMatch(/import \{[^}]*normalizeRfidScan[^}]*\} from '@\/lib\/rfid-scan'/);
  });

  it('Assign sends the normalised tag value', () => {
    const start = src.indexOf('const handleAssignRfid = async');
    const b = src.slice(start, src.indexOf("reauth.execute('CREATE_ASSET_IDENTIFIER'", start));
    expect(b).toMatch(/const tagValue = normalizeRfidScan\(rfidTagValue\);/);
    expect(b).not.toMatch(/rfidTagValue\.trim\(\)/);
    // The "already assigned" check must compare normalised, not raw ===.
    expect(b).toMatch(/rfidValuesMatch\(t\.identifierValue, tagValue\)/);
  });

  it('the SUPER_ADMIN edit sends and compares the normalised tag', () => {
    expect(src).toMatch(/normalizeRfidScan\(editFilterRfid\) !== normalizeRfidScan\(d\.rfid\) \? \{ rfidNumber: normalizeRfidScan\(editFilterRfid\) \}/);
    expect(src).not.toMatch(/rfidNumber: editFilterRfid\.trim\(\)/);
  });

  it('the normaliser does what these paths rely on', () => {
    expect(normalizeRfidScan(' e200abcd ')).toBe('E200ABCD');
    expect(normalizeRfidScan('E200ABCDE200ABCD')).toBe('E200ABCD');
    expect(normalizeRfidScan('')).toBe('');
  });
});
