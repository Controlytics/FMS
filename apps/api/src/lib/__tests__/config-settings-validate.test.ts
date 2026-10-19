/**
 * QA-D003 (2026-10-19): server-side validation of the 12 config defs served by
 * PUT /api/config/dynamic/:key, driven by each def's own declared settings.
 * Uses the REAL defs so a def change that breaks a stored shape shows up here.
 */
import { describe, it, expect } from 'vitest';
import { validateAgainstSettings } from '../config-settings-validate.js';
import { stageInterlockDef } from '../../modules/config/defs/stage-interlock.def.js';
import { exportLimitDef } from '../../modules/config/defs/export-limit.def.js';
import { filterApprovalDef } from '../../modules/config/defs/filter-approval.def.js';

const v = (def: { settings: any[] }, body: Record<string, unknown>) => validateAgainstSettings(def.settings, body);

describe('validateAgainstSettings — what used to be stored verbatim is now refused', () => {
  it('refuses a non-boolean for a boolean gate (stage interlock "enabled")', () => {
    expect(v(stageInterlockDef, { enabled: 'yes' })).toHaveLength(1);
    expect(v(stageInterlockDef, { enabled: 1 })).toHaveLength(1);
    expect(v(stageInterlockDef, { requireDifferentApprover: 'false' })).toHaveLength(1);
  });

  it('refuses an out-of-range or non-numeric number (export limit)', () => {
    expect(v(exportLimitDef, { maxRecords: 0 })).toHaveLength(1);
    expect(v(exportLimitDef, { maxRecords: -5 })).toHaveLength(1);
    expect(v(exportLimitDef, { maxRecords: '100' })).toHaveLength(1);
    expect(v(exportLimitDef, { maxRecords: Number.NaN })).toHaveLength(1);
  });

  it('refuses a non-text value for a text setting', () => {
    expect(v(exportLimitDef, { message: { html: '<b>x</b>' } })).toHaveLength(1);
  });

  it('refuses an object where a role list is expected', () => {
    expect(v(filterApprovalDef, { uploadRole: { role: 'ADMIN' } })).toHaveLength(1);
    expect(v(filterApprovalDef, { uploadRole: [{}] })).toHaveLength(1);
  });
});

describe('validateAgainstSettings — every shape pages send or databases hold still passes', () => {
  it('accepts the shapes stored on the clones and the test DB', () => {
    expect(v(stageInterlockDef, { enabled: true, requireDifferentApprover: true, washOutApproverRole: 'SHIFTOFFICER', dryOutApproverRole: 'SHIFTOFFICER' })).toEqual([]);
    expect(v(filterApprovalDef, { reviewRole: '', uploadRole: '', approvalRole: '', workflowEnabled: false })).toEqual([]);
    expect(v(filterApprovalDef, { uploadRole: ['SUPERVISOR', 'QA'], workflowEnabled: true })).toEqual([]);
  });

  it('accepts a legacy single-string role (normalizeRoles reads both)', () => {
    expect(v(filterApprovalDef, { uploadRole: 'SUPERVISOR' })).toEqual([]);
  });

  it('treats a cleared number field ("") and absent / null values as not set', () => {
    expect(v(exportLimitDef, { maxRecords: '' })).toEqual([]);
    expect(v(exportLimitDef, {})).toEqual([]);
    expect(v(exportLimitDef, { maxRecords: null })).toEqual([]);
  });

  it('leaves keys the def does not declare alone (pages may keep extra structure)', () => {
    expect(v(stageInterlockDef, { enabled: false, somethingElse: { a: 1 } })).toEqual([]);
  });

  it('accepts a role select whose options are live data (dynamicOptionsSource)', () => {
    expect(v(stageInterlockDef, { washOutApproverRole: 'A_CUSTOM_ROLE' })).toEqual([]);
  });
});
