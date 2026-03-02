import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Checklist Answer Processing Unit Tests
 *
 * Tests the saveChecklist function with all 14 question type answer formats.
 * Verifies SHA-256 hash generation, metadata stripping, and TSDB persistence.
 */

const { mockPrisma, mockTsdbPool } = vi.hoisted(() => ({
  mockPrisma: {
    $queryRawUnsafe: vi.fn(),
    assetInstance: { findUnique: vi.fn(), update: vi.fn() },
    dataStream: { upsert: vi.fn() },
    checklistReview: { create: vi.fn() },
    alarm: { create: vi.fn() },
  },
  mockTsdbPool: { query: vi.fn() },
}));

vi.mock('../../../lib/prisma.js', () => ({ prisma: mockPrisma }));
vi.mock('@digilog/db', () => ({
  addTelemetryRow: vi.fn(),
  getTsdbPool: () => mockTsdbPool,
}));
vi.mock('fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

import { saveChecklist } from '../ingestion.repository.js';

const makeChecklistMsg = (data: Record<string, any>, overrides: Record<string, any> = {}) => ({
  messageId: 'msg-cl-1',
  timestamp: '2026-03-02T10:30:00Z',
  protocol: 'http' as const,
  entityId: 'ent-1',
  entityName: 'Test-Entity',
  templateId: 'tmpl-1',
  unsPath: 'digilog/v1/test-entity',
  credentialId: 'cred-1',
  sourceIp: '192.168.1.10',
  messageType: 'POST_CHECKLIST' as const,
  data,
  metadata: {},
  ruleChainId: '',
  traceId: 'trace-cl-1',
  ...overrides,
});

describe('saveChecklist — All Question Types', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTsdbPool.query.mockResolvedValue({ rows: [] });
    mockPrisma.checklistReview.create.mockResolvedValue({ id: 'review-1' });
  });

  // =============================================
  // Basic persistence
  // =============================================
  describe('Basic persistence', () => {
    it('saves checklist and returns checklistId', async () => {
      const msg = makeChecklistMsg({ q_0: 'PASS', _userId: 'admin', _userSub: 'sub-1' });
      const result = await saveChecklist(msg);

      expect(result.checklistId).toBeDefined();
      expect(typeof result.checklistId).toBe('string');
    });

    it('inserts into TSDB via pool.query', async () => {
      const msg = makeChecklistMsg({ q_0: 'YES', _userId: 'admin' });
      await saveChecklist(msg);

      expect(mockTsdbPool.query).toHaveBeenCalledTimes(1);
      const [sql, params] = mockTsdbPool.query.mock.calls[0];
      expect(sql).toContain('INSERT INTO ts_checklist_responses');
      expect(params).toBeDefined();
    });

    it('creates ChecklistReview in PG with SUBMITTED status', async () => {
      const msg = makeChecklistMsg({ q_0: 'PASS', _userId: 'admin' });
      await saveChecklist(msg);

      expect(mockPrisma.checklistReview.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          currentStep: 'SUBMITTED',
          currentSequence: 1,
        }),
      });
    });

    it('strips metadata keys (_userId, _userSub, _remarks) from answers', async () => {
      const msg = makeChecklistMsg({
        q_0: 'PASS',
        q_1: 'YES',
        _userId: 'operator1',
        _userSub: 'uuid-1',
        _remarks: 'Test remark',
      });
      await saveChecklist(msg);

      const [, params] = mockTsdbPool.query.mock.calls[0];
      const answersJson = params[5]; // answers param position
      const answers = JSON.parse(answersJson);
      expect(answers._userId).toBeUndefined();
      expect(answers._userSub).toBeUndefined();
      expect(answers._remarks).toBeUndefined();
      expect(answers.q_0).toBe('PASS');
      expect(answers.q_1).toBe('YES');
    });

    it('generates SHA-256 answers_hash for compliance', async () => {
      const msg = makeChecklistMsg({ q_0: 'PASS', _userId: 'admin' });
      await saveChecklist(msg);

      const [, params] = mockTsdbPool.query.mock.calls[0];
      const hash = params[6]; // answers_hash param position
      // SHA-256 hash is 64 hex chars
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  // =============================================
  // PASS_FAIL answers
  // =============================================
  describe('PASS_FAIL answers', () => {
    it('saves PASS value', async () => {
      const msg = makeChecklistMsg({ q_0: 'PASS', _userId: 'admin' });
      await saveChecklist(msg);

      const answers = JSON.parse(mockTsdbPool.query.mock.calls[0][1][5]);
      expect(answers.q_0).toBe('PASS');
    });

    it('saves FAIL value', async () => {
      const msg = makeChecklistMsg({ q_0: 'FAIL', _userId: 'admin' });
      await saveChecklist(msg);

      const answers = JSON.parse(mockTsdbPool.query.mock.calls[0][1][5]);
      expect(answers.q_0).toBe('FAIL');
    });
  });

  // =============================================
  // YES_NO answers
  // =============================================
  describe('YES_NO answers', () => {
    it('saves YES value', async () => {
      const msg = makeChecklistMsg({ q_0: 'YES', _userId: 'admin' });
      await saveChecklist(msg);

      const answers = JSON.parse(mockTsdbPool.query.mock.calls[0][1][5]);
      expect(answers.q_0).toBe('YES');
    });

    it('saves NO value', async () => {
      const msg = makeChecklistMsg({ q_0: 'NO', _userId: 'admin' });
      await saveChecklist(msg);

      const answers = JSON.parse(mockTsdbPool.query.mock.calls[0][1][5]);
      expect(answers.q_0).toBe('NO');
    });
  });

  // =============================================
  // YES_NO_NA answers
  // =============================================
  describe('YES_NO_NA answers', () => {
    it('saves NA value', async () => {
      const msg = makeChecklistMsg({ q_0: 'NA', _userId: 'admin' });
      await saveChecklist(msg);

      const answers = JSON.parse(mockTsdbPool.query.mock.calls[0][1][5]);
      expect(answers.q_0).toBe('NA');
    });
  });

  // =============================================
  // MCQ answers (FIX-024)
  // =============================================
  describe('MCQ answers (FIX-024)', () => {
    it('saves single selected option as string', async () => {
      const msg = makeChecklistMsg({ q_0: 'Operational', _userId: 'admin' });
      await saveChecklist(msg);

      const answers = JSON.parse(mockTsdbPool.query.mock.calls[0][1][5]);
      expect(answers.q_0).toBe('Operational');
      expect(typeof answers.q_0).toBe('string');
    });

    it('saves different MCQ option', async () => {
      const msg = makeChecklistMsg({ q_0: 'Needs Repair', _userId: 'admin' });
      await saveChecklist(msg);

      const answers = JSON.parse(mockTsdbPool.query.mock.calls[0][1][5]);
      expect(answers.q_0).toBe('Needs Repair');
    });
  });

  // =============================================
  // MULTI_SELECT answers (FIX-024)
  // =============================================
  describe('MULTI_SELECT answers (FIX-024)', () => {
    it('saves array of selected options', async () => {
      const msg = makeChecklistMsg({ q_0: ['Leak', 'Vibration'], _userId: 'admin' });
      await saveChecklist(msg);

      const answers = JSON.parse(mockTsdbPool.query.mock.calls[0][1][5]);
      expect(Array.isArray(answers.q_0)).toBe(true);
      expect(answers.q_0).toEqual(['Leak', 'Vibration']);
    });

    it('saves single-item array', async () => {
      const msg = makeChecklistMsg({ q_0: ['Corrosion'], _userId: 'admin' });
      await saveChecklist(msg);

      const answers = JSON.parse(mockTsdbPool.query.mock.calls[0][1][5]);
      expect(answers.q_0).toEqual(['Corrosion']);
    });

    it('saves empty array when nothing selected', async () => {
      const msg = makeChecklistMsg({ q_0: [], _userId: 'admin' });
      await saveChecklist(msg);

      const answers = JSON.parse(mockTsdbPool.query.mock.calls[0][1][5]);
      expect(answers.q_0).toEqual([]);
    });
  });

  // =============================================
  // TEXT answers
  // =============================================
  describe('TEXT answers', () => {
    it('saves free text string', async () => {
      const msg = makeChecklistMsg({ q_0: 'All observations normal', _userId: 'admin' });
      await saveChecklist(msg);

      const answers = JSON.parse(mockTsdbPool.query.mock.calls[0][1][5]);
      expect(answers.q_0).toBe('All observations normal');
    });

    it('preserves special characters in text', async () => {
      const msg = makeChecklistMsg({ q_0: 'Temp = 25°C & pressure < 3 bar', _userId: 'admin' });
      await saveChecklist(msg);

      const answers = JSON.parse(mockTsdbPool.query.mock.calls[0][1][5]);
      expect(answers.q_0).toBe('Temp = 25°C & pressure < 3 bar');
    });
  });

  // =============================================
  // NUMERIC answers
  // =============================================
  describe('NUMERIC answers', () => {
    it('saves numeric string value', async () => {
      const msg = makeChecklistMsg({ q_0: '42.5', _userId: 'admin' });
      await saveChecklist(msg);

      const answers = JSON.parse(mockTsdbPool.query.mock.calls[0][1][5]);
      expect(answers.q_0).toBe('42.5');
    });

    it('saves negative number', async () => {
      const msg = makeChecklistMsg({ q_0: '-10.3', _userId: 'admin' });
      await saveChecklist(msg);

      const answers = JSON.parse(mockTsdbPool.query.mock.calls[0][1][5]);
      expect(answers.q_0).toBe('-10.3');
    });

    it('saves zero', async () => {
      const msg = makeChecklistMsg({ q_0: '0', _userId: 'admin' });
      await saveChecklist(msg);

      const answers = JSON.parse(mockTsdbPool.query.mock.calls[0][1][5]);
      expect(answers.q_0).toBe('0');
    });
  });

  // =============================================
  // DROPDOWN answers
  // =============================================
  describe('DROPDOWN answers', () => {
    it('saves selected dropdown option', async () => {
      const msg = makeChecklistMsg({ q_0: 'Morning (6AM-2PM)', _userId: 'admin' });
      await saveChecklist(msg);

      const answers = JSON.parse(mockTsdbPool.query.mock.calls[0][1][5]);
      expect(answers.q_0).toBe('Morning (6AM-2PM)');
    });
  });

  // =============================================
  // PHOTO answers
  // =============================================
  describe('PHOTO answers', () => {
    it('saves base64 photo data URL', async () => {
      const photoData = 'data:image/jpeg;base64,/9j/4AAQSkZJRg...';
      const msg = makeChecklistMsg({ q_0: photoData, _userId: 'admin' });
      await saveChecklist(msg);

      const answers = JSON.parse(mockTsdbPool.query.mock.calls[0][1][5]);
      expect(answers.q_0).toBe(photoData);
      expect(answers.q_0.startsWith('data:image/')).toBe(true);
    });

    it('saves null when photo is skipped', async () => {
      const msg = makeChecklistMsg({ q_0: null, _userId: 'admin' });
      await saveChecklist(msg);

      const answers = JSON.parse(mockTsdbPool.query.mock.calls[0][1][5]);
      expect(answers.q_0).toBeNull();
    });
  });

  // =============================================
  // DATE_TIME answers
  // =============================================
  describe('DATE_TIME answers', () => {
    it('saves ISO datetime string', async () => {
      const msg = makeChecklistMsg({ q_0: '2026-03-02T10:30', _userId: 'admin' });
      await saveChecklist(msg);

      const answers = JSON.parse(mockTsdbPool.query.mock.calls[0][1][5]);
      expect(answers.q_0).toBe('2026-03-02T10:30');
    });
  });

  // =============================================
  // SIGNATURE answers
  // =============================================
  describe('SIGNATURE answers', () => {
    it('saves base64 PNG signature', async () => {
      const sigData = 'data:image/png;base64,iVBORw0KGgo...';
      const msg = makeChecklistMsg({ q_0: sigData, _userId: 'admin' });
      await saveChecklist(msg);

      const answers = JSON.parse(mockTsdbPool.query.mock.calls[0][1][5]);
      expect(answers.q_0).toBe(sigData);
    });

    it('saves null when signature cleared', async () => {
      const msg = makeChecklistMsg({ q_0: null, _userId: 'admin' });
      await saveChecklist(msg);

      const answers = JSON.parse(mockTsdbPool.query.mock.calls[0][1][5]);
      expect(answers.q_0).toBeNull();
    });
  });

  // =============================================
  // YES_NO_COMMENT answers
  // =============================================
  describe('YES_NO_COMMENT answers', () => {
    it('saves YES with pipe-delimited comment', async () => {
      const msg = makeChecklistMsg({ q_0: 'YES|Schedule next week', _userId: 'admin' });
      await saveChecklist(msg);

      const answers = JSON.parse(mockTsdbPool.query.mock.calls[0][1][5]);
      expect(answers.q_0).toBe('YES|Schedule next week');
      const [yn, comment] = answers.q_0.split('|');
      expect(yn).toBe('YES');
      expect(comment).toBe('Schedule next week');
    });

    it('saves NO without comment', async () => {
      const msg = makeChecklistMsg({ q_0: 'NO', _userId: 'admin' });
      await saveChecklist(msg);

      const answers = JSON.parse(mockTsdbPool.query.mock.calls[0][1][5]);
      expect(answers.q_0).toBe('NO');
    });

    it('preserves pipe characters in comments', async () => {
      const msg = makeChecklistMsg({ q_0: 'YES|Line 1|Line 2', _userId: 'admin' });
      await saveChecklist(msg);

      const answers = JSON.parse(mockTsdbPool.query.mock.calls[0][1][5]);
      expect(answers.q_0).toBe('YES|Line 1|Line 2');
    });
  });

  // =============================================
  // CALCULATED answers
  // =============================================
  describe('CALCULATED answers', () => {
    it('saves pre-computed value from frontend', async () => {
      const msg = makeChecklistMsg({ q_0: '25.5', q_1: '3.2', q_2: '28.7', _userId: 'admin' });
      await saveChecklist(msg);

      const answers = JSON.parse(mockTsdbPool.query.mock.calls[0][1][5]);
      expect(answers.q_2).toBe('28.7');
    });
  });

  // =============================================
  // CONDITIONAL answers
  // =============================================
  describe('CONDITIONAL answers', () => {
    it('saves conditional text when condition met', async () => {
      const msg = makeChecklistMsg({
        q_0: 'Needs Repair',  // trigger value
        q_1: 'Replace bearing on motor shaft',  // conditional answer
        _userId: 'admin',
      });
      await saveChecklist(msg);

      const answers = JSON.parse(mockTsdbPool.query.mock.calls[0][1][5]);
      expect(answers.q_1).toBe('Replace bearing on motor shaft');
    });

    it('omits conditional answer when not included', async () => {
      const msg = makeChecklistMsg({
        q_0: 'Operational',  // condition not met, q_1 not sent
        _userId: 'admin',
      });
      await saveChecklist(msg);

      const answers = JSON.parse(mockTsdbPool.query.mock.calls[0][1][5]);
      expect(answers.q_1).toBeUndefined();
    });
  });

  // =============================================
  // Complete submission with all 14 types
  // =============================================
  describe('Complete submission with all 14 types', () => {
    it('saves a full checklist with all answer types', async () => {
      const msg = makeChecklistMsg({
        q_0: 'PASS',                               // PASS_FAIL
        q_1: 'YES',                                // YES_NO
        q_2: 'NA',                                 // YES_NO_NA
        q_3: 'Good',                               // MCQ
        q_4: ['Leak', 'Vibration'],                // MULTI_SELECT
        q_5: 'All normal',                         // TEXT
        q_6: '42.5',                               // NUMERIC
        q_7: 'Morning',                            // DROPDOWN
        q_8: null,                                 // PHOTO (skipped)
        q_9: '2026-03-02T10:30',                   // DATE_TIME
        q_10: 'data:image/png;base64,iVBORw0...',  // SIGNATURE
        q_11: 'YES|All good',                      // YES_NO_COMMENT
        q_12: '85',                                // CALCULATED
        q_13: null,                                // CONDITIONAL (hidden)
        _userId: 'admin',
        _userSub: 'sub-1',
        _remarks: 'Routine check',
      });
      const result = await saveChecklist(msg);

      // Verify checklistId returned
      expect(result.checklistId).toBeDefined();

      // Verify TSDB insert
      expect(mockTsdbPool.query).toHaveBeenCalledTimes(1);
      const [sql, params] = mockTsdbPool.query.mock.calls[0];
      expect(sql).toContain('INSERT INTO ts_checklist_responses');

      // Verify answers stored correctly (metadata stripped)
      const storedAnswers = JSON.parse(params[5]);
      expect(storedAnswers.q_0).toBe('PASS');
      expect(storedAnswers.q_3).toBe('Good');
      expect(storedAnswers.q_4).toEqual(['Leak', 'Vibration']);
      expect(storedAnswers.q_11).toBe('YES|All good');
      expect(storedAnswers._userId).toBeUndefined();
      expect(storedAnswers._remarks).toBeUndefined();

      // Verify hash is present and valid
      const hash = params[6];
      expect(hash).toMatch(/^[0-9a-f]{64}$/);

      // Verify PG review created
      expect(mockPrisma.checklistReview.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          currentStep: 'SUBMITTED',
          currentSequence: 1,
          entityId: 'ent-1',
          templateId: 'tmpl-1',
        }),
      });
    });

    it('generates different hashes for different answers', async () => {
      const msg1 = makeChecklistMsg({ q_0: 'PASS', _userId: 'admin' });
      const msg2 = makeChecklistMsg({ q_0: 'FAIL', _userId: 'admin' });

      await saveChecklist(msg1);
      const hash1 = mockTsdbPool.query.mock.calls[0][1][6];

      vi.clearAllMocks();
      mockTsdbPool.query.mockResolvedValue({ rows: [] });
      mockPrisma.checklistReview.create.mockResolvedValue({ id: 'review-2' });

      await saveChecklist(msg2);
      const hash2 = mockTsdbPool.query.mock.calls[0][1][6];

      expect(hash1).not.toBe(hash2);
    });

    it('generates same hash for same answers (deterministic)', async () => {
      const msg1 = makeChecklistMsg({ q_0: 'PASS', q_1: 'YES', _userId: 'admin' });

      await saveChecklist(msg1);
      const hash1 = mockTsdbPool.query.mock.calls[0][1][6];

      vi.clearAllMocks();
      mockTsdbPool.query.mockResolvedValue({ rows: [] });
      mockPrisma.checklistReview.create.mockResolvedValue({ id: 'review-2' });

      const msg2 = makeChecklistMsg({ q_0: 'PASS', q_1: 'YES', _userId: 'admin' });
      await saveChecklist(msg2);
      const hash2 = mockTsdbPool.query.mock.calls[0][1][6];

      expect(hash1).toBe(hash2);
    });
  });
});
