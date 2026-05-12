import { describe, it, expect, beforeEach } from 'vitest';
import { isFeatureEnabled, FEATURE_FLAGS } from '../feature-flags.js';

describe('feature-flags', () => {
  beforeEach(() => {
    delete process.env.USE_MOSQUITTO;
    delete process.env.USE_PG_QUEUE;
    delete process.env.USE_EDGE_PDF;
  });

  it('defaults all migration flags to false', () => {
    expect(isFeatureEnabled(FEATURE_FLAGS.USE_MOSQUITTO)).toBe(false);
    expect(isFeatureEnabled(FEATURE_FLAGS.USE_PG_QUEUE)).toBe(false);
    expect(isFeatureEnabled(FEATURE_FLAGS.USE_EDGE_PDF)).toBe(false);
  });

  it('reads truthy strings as enabled', () => {
    process.env.USE_MOSQUITTO = 'true';
    expect(isFeatureEnabled(FEATURE_FLAGS.USE_MOSQUITTO)).toBe(true);
  });

  it('treats "false", "0", and "" as disabled', () => {
    for (const value of ['false', '0', '']) {
      process.env.USE_MOSQUITTO = value;
      expect(isFeatureEnabled(FEATURE_FLAGS.USE_MOSQUITTO)).toBe(false);
    }
  });

  it('treats truthy strings case-insensitively and ignores surrounding whitespace', () => {
    for (const value of ['true', 'TRUE', 'True', '1', 'yes', 'YES', '  true  ']) {
      process.env.USE_MOSQUITTO = value;
      expect(isFeatureEnabled(FEATURE_FLAGS.USE_MOSQUITTO)).toBe(true);
    }
  });

  it('treats arbitrary non-truthy strings as disabled', () => {
    for (const value of ['no', 'off', 'maybe', 'enabled', '2']) {
      process.env.USE_MOSQUITTO = value;
      expect(isFeatureEnabled(FEATURE_FLAGS.USE_MOSQUITTO)).toBe(false);
    }
  });
});
