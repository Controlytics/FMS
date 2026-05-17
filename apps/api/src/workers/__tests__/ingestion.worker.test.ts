import { describe, it, expect, beforeEach, vi } from 'vitest';

const {
  mockGetConfigOrDefault,
  mockProcessIngestionMessage,
} = vi.hoisted(() => ({
  mockGetConfigOrDefault: vi.fn(),
  mockProcessIngestionMessage: vi.fn(),
}));

vi.mock('../../modules/data-ingestion/ingestion-config.service.js', () => ({
  getConfigOrDefault: mockGetConfigOrDefault,
}));

vi.mock('../../modules/data-ingestion/ingestion.service.js', () => ({
  processIngestionMessage: mockProcessIngestionMessage,
}));

import { ingestionTask } from '../ingestion.worker.js';
import type { IngestionMessage } from '../../modules/data-ingestion/message-normalizer.js';

describe('ingestion.worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── graphile-worker Task tests ─────────────────────────
  // Task 2.10 dropped the legacy BullMQ Worker tests; only the
  // ingestionTask path remains.
  describe('ingestionTask (graphile-worker)', () => {
    function makeMsg(messageId: string): IngestionMessage {
      return {
        messageId,
        timestamp: new Date().toISOString(),
        protocol: 'mqtt',
        entityId: 'ent-1',
        entityName: 'AHU-01',
        templateId: 'tpl-1',
        unsPath: 'digilog/v1/site/area/ahu',
        credentialId: 'cred-1',
        sourceIp: '',
        messageType: 'POST_TELEMETRY',
        data: { temperature: 22.5 },
        metadata: {},
        traceId: 'trace-1',
      };
    }

    function makeHelpers() {
      const warn = vi.fn();
      const helpers = { logger: { info: vi.fn(), warn, error: vi.fn() } } as never;
      return { warn, helpers };
    }

    it('processes a wrapped { msg } payload via processIngestionMessage', async () => {
      mockProcessIngestionMessage.mockResolvedValueOnce({
        success: true,
        messageId: 'msg-ok',
        warnings: [],
      });
      const msg = makeMsg('msg-ok');
      const { helpers, warn } = makeHelpers();

      await expect(
        ingestionTask({ msg }, helpers),
      ).resolves.not.toThrow();

      expect(mockProcessIngestionMessage).toHaveBeenCalledWith(msg);
      expect(warn).not.toHaveBeenCalled();
    });

    it('logs a warning via helpers.logger.warn when processIngestionMessage returns success: false', async () => {
      mockProcessIngestionMessage.mockResolvedValueOnce({
        success: false,
        messageId: 'msg-fail',
        warnings: [],
      });
      const msg = makeMsg('msg-fail');
      const { helpers, warn } = makeHelpers();

      await ingestionTask({ msg }, helpers);

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toEqual(expect.stringContaining('msg-fail'));
    });

    it('throws on a malformed payload (no msg key)', async () => {
      const error = vi.fn();
      const helpers = { logger: { info: vi.fn(), warn: vi.fn(), error } } as never;

      await expect(
        ingestionTask({ wrong: 'shape' } as never, helpers),
      ).rejects.toThrow('INVALID_INGESTION_PAYLOAD');
      expect(error).toHaveBeenCalledTimes(1);
      expect(mockProcessIngestionMessage).not.toHaveBeenCalled();
    });
  });
});
