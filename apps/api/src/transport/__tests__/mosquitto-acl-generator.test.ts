import { describe, it, expect } from 'vitest';
import { generateDynamicSecurity } from '../mosquitto-acl-generator.js';

describe('generateDynamicSecurity', () => {
  it('produces a valid Mosquitto v2 dynamic-security JSON skeleton', () => {
    const result = generateDynamicSecurity({ devices: [], adminPassword: 'admin-secret' });
    expect(result).toHaveProperty('clients');
    expect(result).toHaveProperty('groups');
    expect(result).toHaveProperty('roles');
    expect(result.clients).toEqual([
      expect.objectContaining({ username: 'admin', password: expect.any(String) }),
    ]);
  });

  it('emits one client per device with publish-only ACL on its own topic', () => {
    const result = generateDynamicSecurity({
      devices: [
        { token: 'tok-A', entityId: 'ent-A' },
        { token: 'tok-B', entityId: 'ent-B' },
      ],
      adminPassword: 'admin-secret',
    });
    expect(result.clients).toHaveLength(3); // admin + 2 devices
    const deviceA = result.clients.find((c) => c.username === 'tok-A');
    expect(deviceA?.roles).toContainEqual(
      expect.objectContaining({ rolename: expect.stringContaining('ent-A') })
    );
  });

  it('hashes admin password using bcrypt-compatible scheme', () => {
    const result = generateDynamicSecurity({ devices: [], adminPassword: 'admin-secret' });
    const admin = result.clients[0];
    expect(admin.password).toMatch(/^\$2[aby]\$\d{2}\$.{53}$/); // bcrypt
  });
});
