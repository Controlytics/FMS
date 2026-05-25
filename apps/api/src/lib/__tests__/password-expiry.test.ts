import { describe, it, expect } from 'vitest';
import { isPasswordExpired } from '../password-expiry.js';

const day = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * day);

describe('isPasswordExpired', () => {
  it('returns false when policy days is 0 (no expiry)', () => {
    expect(isPasswordExpired(daysAgo(365), daysAgo(365), 0, daysAgo(365))).toBe(false);
  });

  it('returns false when policy days is undefined', () => {
    expect(isPasswordExpired(daysAgo(365), daysAgo(365), undefined, null)).toBe(false);
  });

  it('falls back to createdAt when passwordChangedAt is null', () => {
    expect(isPasswordExpired(null, daysAgo(10), 5, daysAgo(365))).toBe(true);
    expect(isPasswordExpired(null, daysAgo(2), 5, daysAgo(365))).toBe(false);
  });

  it('expires when password is older than the policy window', () => {
    expect(isPasswordExpired(daysAgo(10), daysAgo(20), 5, daysAgo(365))).toBe(true);
  });

  it('does NOT expire when password is younger than the policy window', () => {
    expect(isPasswordExpired(daysAgo(2), daysAgo(20), 5, daysAgo(365))).toBe(false);
  });

  // The 2026-05-25 bug: admin lowers passwordExpiryDays from 120 to 1 and
  // every account with an older password gets force-flagged on the next
  // request. policyUpdatedAt acts as a floor so the new window is granted
  // as a grace period from the save time.
  describe('grace floor (policyUpdatedAt)', () => {
    it('does NOT expire an old password right after the policy was just lowered', () => {
      // password from 100 days ago, policy was just saved 5 minutes ago at 1 day.
      // Without the floor: 100d > 1d ⇒ expired. With the floor: anchor = NOW-5min,
      // expiry = NOW-5min+1d, still in the future ⇒ not expired.
      const policySavedJustNow = new Date(Date.now() - 5 * 60 * 1000);
      expect(isPasswordExpired(daysAgo(100), daysAgo(200), 1, policySavedJustNow)).toBe(false);
    });

    it('DOES expire an old password after the grace window has elapsed', () => {
      // Same scenario but the policy was saved 2 days ago and window is 1 day.
      const policySaved2DaysAgo = daysAgo(2);
      expect(isPasswordExpired(daysAgo(100), daysAgo(200), 1, policySaved2DaysAgo)).toBe(true);
    });

    it('uses passwordChangedAt when it is newer than policyUpdatedAt', () => {
      // User changed password yesterday, policy saved a year ago, window 5 days.
      // Should NOT be expired (anchor = yesterday, expiry = yesterday + 5d).
      expect(isPasswordExpired(daysAgo(1), daysAgo(200), 5, daysAgo(365))).toBe(false);
    });

    it('tolerates a null policyUpdatedAt (legacy / never-saved policy)', () => {
      // No floor available — behaves as if only passwordChangedAt counts.
      expect(isPasswordExpired(daysAgo(10), daysAgo(20), 5, null)).toBe(true);
      expect(isPasswordExpired(daysAgo(2), daysAgo(20), 5, null)).toBe(false);
    });
  });
});
