import { describe, it, expect } from 'vitest';
import { canAccessConfigModule } from '../can-access-module';

describe('canAccessConfigModule — caller with no role', () => {
  it('denies a configured module when the caller has no role at all', () => {
    expect(canAccessConfigModule('backup', { isSuperAdmin: false, accessMatrix: { backup: ['ADMIN'] } })).toBe(false);
  });

  it('denies when no access matrix has loaded (default-deny)', () => {
    expect(canAccessConfigModule('backup', { isSuperAdmin: false, role: 'ADMIN' })).toBe(false);
  });
});
