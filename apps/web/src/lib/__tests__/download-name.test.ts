import { describe, it, expect } from 'vitest';
import { downloadName, downloadStamp, safeFilePart } from '../download-name';

describe('downloadStamp', () => {
  it('is date AND time, so two exports on the same day cannot collide', () => {
    // The reason this exists: every call site was date-only, so a second export
    // the same day landed as "report (1).pdf" with no way to tell them apart.
    const at = new Date(2026, 8, 3, 15, 42, 10); // month is 0-based: September
    expect(downloadStamp(at)).toBe('2026-09-03_15-42-10');
  });

  it('pads every field', () => {
    expect(downloadStamp(new Date(2026, 0, 5, 4, 7, 9))).toBe('2026-01-05_04-07-09');
  });

  it('uses LOCAL time, not UTC', () => {
    // toISOString() is UTC and this deployment runs at UTC+5:30, so anything
    // exported between 00:00 and 05:30 local was stamped the PREVIOUS day.
    const at = new Date(2026, 8, 3, 2, 0, 0); // 02:00 local
    expect(downloadStamp(at).slice(0, 10)).toBe('2026-09-03');
    // …which is precisely where the old UTC form disagreed:
    if (at.getTimezoneOffset() < 0) {
      expect(at.toISOString().slice(0, 10)).not.toBe('2026-09-03');
    }
  });

  it('carries no character a filesystem rejects', () => {
    expect(downloadStamp(new Date(2026, 8, 3, 15, 42, 10))).not.toMatch(/[\\/:*?"<>|]/);
  });
});

describe('safeFilePart', () => {
  it('strips the slashes in a hierarchy path', () => {
    // cycle.filterName is a path like this and went into filenames verbatim.
    expect(safeFilePart('CWH/F1/AHU-0B/SA/05/06-01')).toBe('CWH-F1-AHU-0B-SA-05-06-01');
  });

  it('strips the slashes in a DD/MM/YYYY date', () => {
    // formatDate() returns this under the configured format, and timeline.tsx
    // put it straight in the filename.
    expect(safeFilePart('03/09/2026')).toBe('03-09-2026');
  });

  it('removes every character Windows forbids', () => {
    expect(safeFilePart('a\\b:c*d?e"f<g>h|i')).toBe('a-b-c-d-e-f-g-h-i');
  });

  it('collapses runs and trims the edges rather than leaving stray dashes', () => {
    expect(safeFilePart('  Block A // Filter  ')).toBe('Block-A-Filter');
    expect(safeFilePart('///')).toBe('');
  });
});

describe('downloadName', () => {
  it('joins the parts and appends the stamp', () => {
    expect(downloadName('audit-trail')).toMatch(/^audit-trail_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/);
  });

  it('sanitises every part, not just the first', () => {
    expect(downloadName('cycle', 'CWH/F1/AHU-0B')).toMatch(/^cycle-CWH-F1-AHU-0B_/);
  });

  it('drops empty parts instead of leaving a dangling separator', () => {
    // A cycle with no filter name must not produce "cycle--2026-…".
    expect(downloadName('cycle', undefined)).toMatch(/^cycle_\d{4}/);
    expect(downloadName('cycle', '')).toMatch(/^cycle_\d{4}/);
    expect(downloadName('cycle', '///')).toMatch(/^cycle_\d{4}/);
  });

  it('never yields a name that is only a timestamp', () => {
    expect(downloadName('')).toMatch(/^export_\d{4}/);
  });

  it('produces nothing a filesystem rejects', () => {
    expect(downloadName('a/b', 'c:d', '03/09/2026')).not.toMatch(/[\\/:*?"<>|]/);
  });
});
