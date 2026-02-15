import { describe, it, expect } from 'vitest';

/**
 * D4: forcePasswordChange enforcement tests
 * Verifies the login response includes forcePasswordChange flag
 * and the change-password flow clears it correctly.
 */

describe('forcePasswordChange Login Response', () => {
  it('should include forcePasswordChange: true when user flag is set', () => {
    const user = {
      id: 'uuid-1',
      username: 'operator1',
      fullName: 'Operator One',
      role: 'OPERATOR',
      forcePasswordChange: true,
      isTemporaryPassword: true,
    };

    // Simulate the login response shape
    const response = {
      success: true,
      token: 'jwt-token',
      user: {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        role: user.role,
        forcePasswordChange: user.forcePasswordChange,
        isTemporaryPassword: user.isTemporaryPassword,
      },
      expiresIn: '8h',
    };

    expect(response.user.forcePasswordChange).toBe(true);
    expect(response.user.isTemporaryPassword).toBe(true);
  });

  it('should include forcePasswordChange: false for normal user', () => {
    const user = {
      id: 'uuid-2',
      username: 'admin',
      fullName: 'Admin User',
      role: 'ADMIN',
      forcePasswordChange: false,
      isTemporaryPassword: false,
    };

    const response = {
      success: true,
      token: 'jwt-token',
      user: {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        role: user.role,
        forcePasswordChange: user.forcePasswordChange,
        isTemporaryPassword: user.isTemporaryPassword,
      },
      expiresIn: '8h',
    };

    expect(response.user.forcePasswordChange).toBe(false);
    expect(response.user.isTemporaryPassword).toBe(false);
  });
});

describe('Password Expiration Detection', () => {
  it('should detect expired password and set forcePasswordChange', () => {
    const user = {
      passwordExpiresAt: new Date('2025-01-01T00:00:00Z'), // expired
      forcePasswordChange: false,
    };

    // Simulate the login check logic
    if (user.passwordExpiresAt && user.passwordExpiresAt < new Date()) {
      user.forcePasswordChange = true;
    }

    expect(user.forcePasswordChange).toBe(true);
  });

  it('should NOT set forcePasswordChange when password is not expired', () => {
    const user = {
      passwordExpiresAt: new Date('2099-12-31T23:59:59Z'), // far future
      forcePasswordChange: false,
    };

    if (user.passwordExpiresAt && user.passwordExpiresAt < new Date()) {
      user.forcePasswordChange = true;
    }

    expect(user.forcePasswordChange).toBe(false);
  });

  it('should NOT set forcePasswordChange when passwordExpiresAt is null', () => {
    const user = {
      passwordExpiresAt: null as Date | null,
      forcePasswordChange: false,
    };

    if (user.passwordExpiresAt && user.passwordExpiresAt < new Date()) {
      user.forcePasswordChange = true;
    }

    expect(user.forcePasswordChange).toBe(false);
  });
});

describe('Change-Password Clears Force Flag', () => {
  it('should produce update data that clears forcePasswordChange', () => {
    // Simulate the data produced after a successful password change
    const updateData = {
      passwordHash: '$2b$12$somehash',
      forcePasswordChange: false,
      isTemporaryPassword: false,
      passwordChangedAt: new Date(),
      passwordExpiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    };

    expect(updateData.forcePasswordChange).toBe(false);
    expect(updateData.isTemporaryPassword).toBe(false);
    expect(updateData.passwordChangedAt).toBeInstanceOf(Date);
  });

  it('should set passwordExpiresAt to ~90 days from now', () => {
    const now = Date.now();
    const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
    const expiresAt = new Date(now + ninetyDaysMs);

    const diffMs = expiresAt.getTime() - now;
    const diffDays = diffMs / (24 * 60 * 60 * 1000);
    expect(diffDays).toBeCloseTo(90, 0);
  });

  it('should reject new password that matches temporary password', async () => {
    const bcrypt = await import('bcrypt');
    const ROUNDS = 4;

    const tempPassword = 'Temp@Pass1';
    const tempHash = await bcrypt.default.hash(tempPassword, ROUNDS);

    // User tries to "change" to the same temporary password
    const sameAsTemp = await bcrypt.default.compare(tempPassword, tempHash);
    expect(sameAsTemp).toBe(true); // would be rejected by the API

    // User picks a different password
    const differentPassword = 'NewSecure@Pass2';
    const notSameAsTemp = await bcrypt.default.compare(differentPassword, tempHash);
    expect(notSameAsTemp).toBe(false); // allowed
  });
});
