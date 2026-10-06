import { describe, expect, it } from 'vitest';
import { normalizeRfidScan, rfidValuesMatch } from '../rfid-scan';

describe('normalizeRfidScan', () => {
  it('upper-cases and trims, stripping reader line terminators', () => {
    expect(normalizeRfidScan('  ca000bf8\r\n')).toBe('CA000BF8');
    expect(normalizeRfidScan('\tca000bf8\t')).toBe('CA000BF8');
  });
  it('collapses a doubled EPC', () => {
    expect(normalizeRfidScan('CA000BF8CA000BF8')).toBe('CA000BF8');
  });
  it('collapses a tripled EPC', () => {
    expect(normalizeRfidScan('CA000BF8CA000BF8CA000BF8')).toBe('CA000BF8');
  });
  it('leaves a genuine value alone', () => {
    expect(normalizeRfidScan('CA000BF8')).toBe('CA000BF8');
    expect(normalizeRfidScan('ABAB')).toBe('ABAB'); // < 6 chars: never split
    expect(normalizeRfidScan('CWH/AHU-01/01-00')).toBe('CWH/AHU-01/01-00');
  });
  it('handles empty input', () => {
    expect(normalizeRfidScan('')).toBe('');
    expect(normalizeRfidScan(null)).toBe('');
    expect(normalizeRfidScan(undefined)).toBe('');
  });
});

describe('rfidValuesMatch', () => {
  it('matches regardless of the stored casing', () => {
    expect(rfidValuesMatch('ca000bf8', 'CA000BF8')).toBe(true);
    expect(rfidValuesMatch('CA000BF8 ', 'CA000BF8')).toBe(true);
  });
  it('does not match a different tag or an empty stored value', () => {
    expect(rfidValuesMatch('CA000BF9', 'CA000BF8')).toBe(false);
    expect(rfidValuesMatch(null, 'CA000BF8')).toBe(false);
  });
});
