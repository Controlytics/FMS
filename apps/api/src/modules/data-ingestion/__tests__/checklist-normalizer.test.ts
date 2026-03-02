import { describe, it, expect } from 'vitest';
import { normalizeMessage } from '../message-normalizer.js';
import type { NormalizeParams } from '../message-normalizer.js';

/**
 * Checklist Message Normalization Tests
 *
 * Tests that checklist payloads (all 14 question type answer formats)
 * are correctly normalized through the message normalizer.
 */

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const baseParams: NormalizeParams = {
  protocol: 'http',
  entityId: 'entity-cl-1',
  entityName: 'Checklist-Entity-1',
  templateId: 'template-cl-1',
  unsPath: 'digilog/v1/enterprise/checklist-entity-1',
  credentialId: 'cred-cl-1',
  sourceIp: '192.168.1.50',
  messageType: 'POST_CHECKLIST',
  rawPayload: null,
};

describe('normalizeMessage — Checklist payloads', () => {
  // =============================================
  // Basic normalization
  // =============================================
  describe('Basic normalization', () => {
    it('normalizes a flat checklist response object', () => {
      const msg = normalizeMessage({
        ...baseParams,
        rawPayload: {
          q_0: 'PASS',
          q_1: 'YES',
          q_2: '42.5',
        },
      });

      expect(msg.data).toEqual({
        q_0: 'PASS',
        q_1: 'YES',
        q_2: '42.5',
      });
      expect(msg.messageId).toMatch(UUID_REGEX);
      expect(msg.timestamp).toBeDefined();
    });

    it('preserves metadata keys (_userId, _userSub, _remarks) in data', () => {
      const msg = normalizeMessage({
        ...baseParams,
        rawPayload: {
          q_0: 'PASS',
          _userId: 'operator1',
          _userSub: 'uuid-123',
          _remarks: 'Routine check',
        },
      });

      // Normalizer should pass through ALL keys — stripping happens in saveChecklist
      expect(msg.data._userId).toBe('operator1');
      expect(msg.data._userSub).toBe('uuid-123');
      expect(msg.data._remarks).toBe('Routine check');
      expect(msg.data.q_0).toBe('PASS');
    });

    it('normalizes null payload to empty data', () => {
      const msg = normalizeMessage({ ...baseParams, rawPayload: null });
      expect(msg.data).toEqual({});
    });

    it('normalizes empty object payload', () => {
      const msg = normalizeMessage({ ...baseParams, rawPayload: {} });
      expect(msg.data).toEqual({});
    });

    it('sets correct entity context fields', () => {
      const msg = normalizeMessage({
        ...baseParams,
        rawPayload: { q_0: 'YES' },
      });

      expect(msg.entityId).toBe('entity-cl-1');
      expect(msg.entityName).toBe('Checklist-Entity-1');
      expect(msg.templateId).toBe('template-cl-1');
      expect(msg.unsPath).toBe('digilog/v1/enterprise/checklist-entity-1');
      expect(msg.protocol).toBe('http');
      expect(msg.sourceIp).toBe('192.168.1.50');
    });
  });

  // =============================================
  // MCQ answer normalization (FIX-024)
  // =============================================
  describe('MCQ answer normalization (FIX-024)', () => {
    it('normalizes single MCQ string answer', () => {
      const msg = normalizeMessage({
        ...baseParams,
        rawPayload: { q_0: 'Operational' },
      });
      expect(msg.data.q_0).toBe('Operational');
      expect(typeof msg.data.q_0).toBe('string');
    });

    it('normalizes MCQ answer with spaces', () => {
      const msg = normalizeMessage({
        ...baseParams,
        rawPayload: { q_0: 'Under Maintenance' },
      });
      expect(msg.data.q_0).toBe('Under Maintenance');
    });
  });

  // =============================================
  // MULTI_SELECT answer normalization (FIX-024)
  // =============================================
  describe('MULTI_SELECT answer normalization (FIX-024)', () => {
    it('normalizes array of selected options', () => {
      const msg = normalizeMessage({
        ...baseParams,
        rawPayload: { q_0: ['Leak', 'Vibration', 'Noise'] },
      });
      expect(Array.isArray(msg.data.q_0)).toBe(true);
      expect(msg.data.q_0).toEqual(['Leak', 'Vibration', 'Noise']);
    });

    it('normalizes single-item selection array', () => {
      const msg = normalizeMessage({
        ...baseParams,
        rawPayload: { q_0: ['Corrosion'] },
      });
      expect(msg.data.q_0).toEqual(['Corrosion']);
    });

    it('normalizes empty selection array', () => {
      const msg = normalizeMessage({
        ...baseParams,
        rawPayload: { q_0: [] },
      });
      expect(msg.data.q_0).toEqual([]);
    });
  });

  // =============================================
  // All answer types in one payload
  // =============================================
  describe('Complete checklist payload with all types', () => {
    it('normalizes a full 14-type checklist response', () => {
      const msg = normalizeMessage({
        ...baseParams,
        rawPayload: {
          q_0: 'PASS',                                // PASS_FAIL
          q_1: 'YES',                                 // YES_NO
          q_2: 'NA',                                  // YES_NO_NA
          q_3: 'Good',                                // MCQ
          q_4: ['Leak', 'Vibration'],                 // MULTI_SELECT
          q_5: 'All normal',                          // TEXT
          q_6: '42.5',                                // NUMERIC
          q_7: 'Morning',                             // DROPDOWN
          q_8: null,                                  // PHOTO (skipped)
          q_9: '2026-03-02T10:30',                    // DATE_TIME
          q_10: 'data:image/png;base64,iVBORw0...',   // SIGNATURE
          q_11: 'YES|All good',                       // YES_NO_COMMENT
          q_12: '28.7',                               // CALCULATED
          q_13: null,                                  // CONDITIONAL (hidden)
          _userId: 'admin',
          _userSub: 'sub-uuid',
          _remarks: 'Complete inspection',
        },
      });

      // Verify all answer types preserved
      expect(msg.data.q_0).toBe('PASS');
      expect(msg.data.q_1).toBe('YES');
      expect(msg.data.q_2).toBe('NA');
      expect(msg.data.q_3).toBe('Good');
      expect(msg.data.q_4).toEqual(['Leak', 'Vibration']);
      expect(msg.data.q_5).toBe('All normal');
      expect(msg.data.q_6).toBe('42.5');
      expect(msg.data.q_7).toBe('Morning');
      expect(msg.data.q_8).toBeNull();
      expect(msg.data.q_9).toBe('2026-03-02T10:30');
      expect(msg.data.q_10).toBe('data:image/png;base64,iVBORw0...');
      expect(msg.data.q_11).toBe('YES|All good');
      expect(msg.data.q_12).toBe('28.7');
      expect(msg.data.q_13).toBeNull();

      // Metadata preserved (stripping happens downstream)
      expect(msg.data._userId).toBe('admin');
    });
  });

  // =============================================
  // SIGNATURE data normalization
  // =============================================
  describe('SIGNATURE data normalization', () => {
    it('preserves base64 PNG data URL for signature', () => {
      const sigData = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAA';
      const msg = normalizeMessage({
        ...baseParams,
        rawPayload: { q_0: sigData },
      });
      expect(msg.data.q_0).toBe(sigData);
    });
  });

  // =============================================
  // YES_NO_COMMENT pipe delimiter
  // =============================================
  describe('YES_NO_COMMENT pipe delimiter', () => {
    it('preserves pipe-delimited YES|comment format', () => {
      const msg = normalizeMessage({
        ...baseParams,
        rawPayload: { q_0: 'YES|Need to recheck tomorrow' },
      });
      expect(msg.data.q_0).toBe('YES|Need to recheck tomorrow');
    });

    it('preserves multiple pipes in comment', () => {
      const msg = normalizeMessage({
        ...baseParams,
        rawPayload: { q_0: 'NO|Reason 1|Reason 2|Reason 3' },
      });
      expect(msg.data.q_0).toBe('NO|Reason 1|Reason 2|Reason 3');
    });

    it('preserves bare YES/NO without comment', () => {
      const msg = normalizeMessage({
        ...baseParams,
        rawPayload: { q_0: 'NO' },
      });
      expect(msg.data.q_0).toBe('NO');
    });
  });

  // =============================================
  // PHOTO data normalization
  // =============================================
  describe('PHOTO data normalization', () => {
    it('preserves base64 JPEG data URL', () => {
      const photoData = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD...';
      const msg = normalizeMessage({
        ...baseParams,
        rawPayload: { q_0: photoData },
      });
      expect(msg.data.q_0).toBe(photoData);
    });

    it('preserves null for skipped photo', () => {
      const msg = normalizeMessage({
        ...baseParams,
        rawPayload: { q_0: null },
      });
      expect(msg.data.q_0).toBeNull();
    });
  });

  // =============================================
  // Edge cases
  // =============================================
  describe('Edge cases', () => {
    it('handles very long text answers', () => {
      const longText = 'A'.repeat(5000);
      const msg = normalizeMessage({
        ...baseParams,
        rawPayload: { q_0: longText },
      });
      expect(msg.data.q_0).toBe(longText);
      expect((msg.data.q_0 as string).length).toBe(5000);
    });

    it('handles unicode characters in answers', () => {
      const msg = normalizeMessage({
        ...baseParams,
        rawPayload: { q_0: 'Temperature: 25°C — all good ✓' },
      });
      expect(msg.data.q_0).toBe('Temperature: 25°C — all good ✓');
    });

    it('handles numeric values as numbers (not just strings)', () => {
      const msg = normalizeMessage({
        ...baseParams,
        rawPayload: { q_0: 42.5, q_1: -10 },
      });
      expect(msg.data.q_0).toBe(42.5);
      expect(msg.data.q_1).toBe(-10);
    });

    it('handles boolean values', () => {
      const msg = normalizeMessage({
        ...baseParams,
        rawPayload: { q_0: true, q_1: false },
      });
      expect(msg.data.q_0).toBe(true);
      expect(msg.data.q_1).toBe(false);
    });
  });
});
