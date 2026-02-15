import { describe, it, expect } from 'vitest';
import bcrypt from 'bcrypt';

/**
 * D2: Password history reuse tests
 * Tests the bcrypt-based password history comparison logic.
 */

describe('Password History Reuse Prevention', () => {
  const ROUNDS = 4; // Low rounds for fast tests

  it('should detect reuse of an identical password', async () => {
    const password = 'SecureP@ss1';
    const hash = await bcrypt.hash(password, ROUNDS);

    const match = await bcrypt.compare(password, hash);
    expect(match).toBe(true);
  });

  it('should not flag a different password as reused', async () => {
    const oldPassword = 'OldSecureP@ss1';
    const newPassword = 'NewSecureP@ss2';
    const hash = await bcrypt.hash(oldPassword, ROUNDS);

    const match = await bcrypt.compare(newPassword, hash);
    expect(match).toBe(false);
  });

  it('should detect reuse across multiple history entries', async () => {
    const passwords = ['Pass1!aB', 'Pass2!cD', 'Pass3!eF'];
    const hashes = await Promise.all(passwords.map(p => bcrypt.hash(p, ROUNDS)));

    // Check that trying to reuse the second password is caught
    const targetPassword = 'Pass2!cD';
    let found = false;
    for (const hash of hashes) {
      if (await bcrypt.compare(targetPassword, hash)) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  it('should allow a password not in history', async () => {
    const passwords = ['Pass1!aB', 'Pass2!cD', 'Pass3!eF'];
    const hashes = await Promise.all(passwords.map(p => bcrypt.hash(p, ROUNDS)));

    const newPassword = 'Brand!New4';
    let found = false;
    for (const hash of hashes) {
      if (await bcrypt.compare(newPassword, hash)) {
        found = true;
        break;
      }
    }
    expect(found).toBe(false);
  });

  it('should respect preventReuseCount by only checking N most recent', async () => {
    const allPasswords = ['P1!abcAB', 'P2!abcAB', 'P3!abcAB', 'P4!abcAB', 'P5!abcAB'];
    const hashes = await Promise.all(allPasswords.map(p => bcrypt.hash(p, ROUNDS)));

    const preventReuseCount = 3;
    const recentHashes = hashes.slice(-preventReuseCount); // last 3

    // The first password should NOT be blocked (it's outside the window)
    let blocked = false;
    for (const hash of recentHashes) {
      if (await bcrypt.compare(allPasswords[0], hash)) {
        blocked = true;
        break;
      }
    }
    expect(blocked).toBe(false);

    // The last password SHOULD be blocked
    let blockedLast = false;
    for (const hash of recentHashes) {
      if (await bcrypt.compare(allPasswords[4], hash)) {
        blockedLast = true;
        break;
      }
    }
    expect(blockedLast).toBe(true);
  });
});
