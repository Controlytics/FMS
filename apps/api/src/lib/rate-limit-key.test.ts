import { describe, it, expect } from 'vitest';
import { rateLimitBucket, rateLimitKeyGenerator } from './rate-limit-key.js';

// DEP-5: the whole point is that an attacker rotating the host portion of an
// IPv6 /64 must NOT get a fresh brute-force budget. These tests assert the
// bucketing property directly, since a version bump alone would not fix it.

describe('rateLimitBucket', () => {
  it('keeps IPv4 exact', () => {
    expect(rateLimitBucket('203.0.113.7')).toBe('203.0.113.7');
    expect(rateLimitBucket('203.0.113.8')).not.toBe(rateLimitBucket('203.0.113.7'));
  });

  it('treats IPv4-mapped IPv6 as the underlying IPv4', () => {
    expect(rateLimitBucket('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(rateLimitBucket('::FFFF:203.0.113.7')).toBe('203.0.113.7');
  });

  it('collapses a whole IPv6 /64 to ONE bucket (the actual fix)', () => {
    const same = [
      '2001:db8:abcd:0012::1',
      '2001:db8:abcd:0012::2',
      '2001:db8:abcd:0012:ffff:ffff:ffff:ffff',
      '2001:0db8:abcd:0012:0000:0000:0000:0099',
    ];
    const buckets = new Set(same.map(rateLimitBucket));
    expect(buckets.size).toBe(1);
  });

  it('still separates DIFFERENT /64s — one abuser must not lock out a neighbour', () => {
    expect(rateLimitBucket('2001:db8:abcd:0012::1'))
      .not.toBe(rateLimitBucket('2001:db8:abcd:0013::1'));
  });

  it('normalizes equivalent hextet spellings to the same bucket', () => {
    expect(rateLimitBucket('2001:0db8:0000:0001::5')).toBe(rateLimitBucket('2001:db8:0:1::9'));
  });

  it('ignores a zone index', () => {
    expect(rateLimitBucket('fe80::1%eth0')).toBe(rateLimitBucket('fe80::2'));
  });

  it('gives absent/blank values their own bucket rather than throwing', () => {
    expect(rateLimitBucket(undefined)).toBe('unknown');
    expect(rateLimitBucket(null)).toBe('unknown');
    expect(rateLimitBucket('   ')).toBe('unknown');
  });

  it('does not collapse unparseable values into a single shared bucket', () => {
    expect(rateLimitBucket('not-an-ip')).toBe('not-an-ip');
    expect(rateLimitBucket('also-not-an-ip')).not.toBe(rateLimitBucket('not-an-ip'));
  });

  it('exposes a keyGenerator matching the fastify signature', () => {
    expect(rateLimitKeyGenerator({ ip: '2001:db8:abcd:0012::42' })).toBe(
      rateLimitBucket('2001:db8:abcd:0012::43'),
    );
    expect(rateLimitKeyGenerator({})).toBe('unknown');
  });
});
