import { describe, it, expect } from 'vitest';
import { readableQnnMessage, qnnActionLabel } from '../qnn-message';

// dd/mm/yyyy, as the configured date format renders a day.
const day = (iso: string) => iso.split('-').reverse().join('/');
const read = (m: string | null) => readableQnnMessage(m, day);

describe('readableQnnMessage — messages stored before 2026-10-24 are reworded', () => {
  // Every shape below was copied from digilog_db (2026-10-24).
  it('PM upload, with its batch', () => {
    expect(read('Uploaded — CWH/RDU (2026-11-03) (pending review) [batch B-EE7A3E, 1 of 36 across CWH/RDU, CWH/AHU-01, CWH/AHU-02]'))
      .toBe('PM visit for CWH/RDU on 03/11/2026 uploaded. Waiting for review. Batch B-EE7A3E: 1 of 36 (CWH/RDU, CWH/AHU-01, CWH/AHU-02).');
    expect(read('Uploaded — AHU-1 (2026-11-03)')).toBe('PM visit for AHU-1 on 03/11/2026 uploaded.');
    expect(read('Visit added — AHU-1 (2026-11-03) (pending review)')).toBe('PM visit for AHU-1 on 03/11/2026 added. Waiting for review.');
    expect(read('Uploaded — AHU-1 (2026-11-03) [batch B-1, 2 of 4]')).toBe('PM visit for AHU-1 on 03/11/2026 uploaded. Batch B-1: 2 of 4.');
  });

  it('PM visit steps, which named only the month', () => {
    expect(read('Approved — CWH/RDU (month 10)')).toBe('PM visit for CWH/RDU in October approved.');
    expect(read('Reviewed (sent for approval) — CWH/RDU (month 11)')).toBe('PM visit for CWH/RDU in November reviewed. Sent for approval.');
    expect(read('Edited (applied at once, Super Admin) — CWH/RDU (month 10)'))
      .toBe('PM visit for CWH/RDU in October moved to a new date. Applied at once (Super Admin).');
    expect(read('Rejected at approval — AHU-1 (month 1)')).toBe('PM visit for AHU-1 in January rejected at approval.');
    expect(read('Resubmitted — AHU-1 (month 12)')).toBe('PM visit for AHU-1 in December resubmitted.');
    expect(read('Modified at review — AHU-1 (month 3)')).toBe('PM visit for AHU-1 in March changed at review.');
    expect(read('Edit requested — AHU-1 (month 3)')).toBe('Date change requested for AHU-1 PM visit in March.');
    expect(read('Change rejected at review (visit stays approved) — AHU-1 (month 3)'))
      .toBe('Date change for AHU-1 PM visit in March rejected at review. The visit keeps its date.');
  });

  it('replacement schedule rows and uploads', () => {
    expect(read('Approved — CWH/AHU-01 · 610x610x150 · 15µ · qty 3'))
      .toBe('Filter replacement for CWH/AHU-01 (3 filters, 15 micron, size 610x610x150) approved.');
    expect(read('Reviewed (sent for approval) — CWH/RDU · 610x610x150 · 1µ · qty 1'))
      .toBe('Filter replacement for CWH/RDU (1 filter, 1 micron, size 610x610x150) reviewed. Sent for approval.');
    expect(read('Rejected at review — AHU-9 · qty 2')).toBe('Filter replacement for AHU-9 (2 filters) rejected at review.');
    expect(read('Uploaded replacement schedule (6 entries) — pending review')).toBe('Replacement schedule uploaded with 6 rows. Waiting for review.');
    expect(read('Uploaded replacement schedule (1 entry)')).toBe('Replacement schedule uploaded with 1 row.');
  });

  it('filter workflow', () => {
    expect(read('Filter created (pending review) — L1/AHU-01/03')).toBe('Filter L1/AHU-01/03 created. Waiting for review.');
    expect(read('Filter uploaded (approved at once, Super Admin) — F-1 [batch B-9, 1 of 2]')).toBe('Filter F-1 uploaded. Approved at once (Super Admin). Batch B-9: 1 of 2.');
    expect(read('Filter reviewed (pending approval) — F-1')).toBe('Filter F-1 reviewed. Sent for approval.');
    expect(read('Filter approved (can now be cleaned) — F-1')).toBe('Filter F-1 approved. It can now be cleaned.');
    expect(read('Filter rejected at approval — F-1')).toBe('Filter F-1 rejected at approval.');
  });
});

describe('readableQnnMessage — everything else is shown as stored', () => {
  it('new plain-language messages, unknown text and empty values', () => {
    const now = 'PM visit for CWH/RDU moved from 21/10/2026 to 02/10/2026. Applied at once (Super Admin).';
    expect(read(now)).toBe(now);
    expect(read('Filter replacement for AHU-1 (3 filters, due 15/10/2026) rejected at review. Reason: wrong qty.')).toMatch(/^Filter replacement for AHU-1/);
    expect(read('Typed by a Super Admin — anything (month 13)')).toBe('Typed by a Super Admin — anything (month 13)');
    expect(read('Something — AHU · qty 3')).toBe('Something — AHU · qty 3'); // not one of the old notes
    expect(read(null)).toBe('');
  });
});

describe('qnnActionLabel', () => {
  it('names the action; an unknown code is shown as stored', () => {
    expect(['UPLOAD', 'REVIEW', 'APPROVE', 'REJECT', 'RESUBMIT', 'EDIT'].map(qnnActionLabel))
      .toEqual(['Uploaded', 'Reviewed', 'Approved', 'Rejected', 'Resubmitted', 'Changed']);
    expect(qnnActionLabel('SOMETHING')).toBe('SOMETHING');
  });
});
