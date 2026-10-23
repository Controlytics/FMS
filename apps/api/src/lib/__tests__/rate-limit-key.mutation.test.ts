/**
 * Exact-bucket tests for lib/rate-limit-key.ts (DEP-5), written against the
 * Stryker survivors of 2026-10-23: the existing tests compare buckets with each
 * other, these pin the bucket STRING for the address shapes that reach each
 * branch (leading "::", a long tail, multi-digit mapped IPv4, look-alikes that
 * are not addresses). Listed in vitest.stryker.config.ts.
 */
import { describe, it, expect } from 'vitest';
import { rateLimitBucket } from '../rate-limit-key.js';

describe('rateLimitBucket — exact /64 buckets', () => {
  it('a full 8-hextet address keeps its first four hextets, normalised', () => {
    expect(rateLimitBucket('2001:0db8:85a3:0000:0001:0002:0003:0004')).toBe('2001:db8:85a3:0::/64');
  });

  it('a leading "::" fills the PREFIX with zeros', () => {
    expect(rateLimitBucket('::1:2:3:4:5:6:7')).toBe('0:1:2:3::/64');
    expect(rateLimitBucket('::abcd:1')).toBe('0:0:0:0::/64');
  });

  it('"::" in the middle and at the end', () => {
    expect(rateLimitBucket('2001:db8::abcd')).toBe('2001:db8:0:0::/64');
    expect(rateLimitBucket('2001:db8:1:2::')).toBe('2001:db8:1:2::/64');
  });
});

describe('rateLimitBucket — IPv4-mapped IPv6 and look-alikes', () => {
  it('a mapped address with multi-digit octets is bucketed as that IPv4 exactly', () => {
    expect(rateLimitBucket('::ffff:10.20.30.40')).toBe('10.20.30.40');
    expect(rateLimitBucket('::FFFF:192.168.100.200')).toBe('192.168.100.200');
  });

  it('text around a mapped form is not an address: kept as its own bucket', () => {
    expect(rateLimitBucket('abc::ffff:1.2.3.4')).toBe('abc::ffff:1.2.3.4');
    expect(rateLimitBucket('::ffff:1.2.3.4x')).toBe('::ffff:1.2.3.4x');
  });

  it('eight colon-separated groups that are not hex are not IPv6: kept as given', () => {
    expect(rateLimitBucket('a:b:c:d:e:f:g:h')).toBe('a:b:c:d:e:f:g:h');
  });
});
