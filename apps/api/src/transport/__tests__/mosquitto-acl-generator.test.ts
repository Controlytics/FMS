import { describe, it, expect } from 'vitest';
import { generateDynamicSecurity } from '../mosquitto-acl-generator.js';

const ADMIN_PW = 'admin-secret-password'; // >= 12 chars

describe('generateDynamicSecurity', () => {
  it('produces a valid Mosquitto v2 dynamic-security JSON skeleton', async () => {
    const result = await generateDynamicSecurity({ devices: [], adminPassword: ADMIN_PW });
    expect(result).toHaveProperty('clients');
    expect(result).toHaveProperty('groups');
    expect(result).toHaveProperty('roles');
    expect(result.clients).toEqual([
      expect.objectContaining({ username: 'admin', encoded_password: expect.any(String) }),
    ]);
  });

  it('emits one role + one client per device with a UNS-path-based role name', async () => {
    const result = await generateDynamicSecurity({
      devices: [
        { token: 'tok-A', unsPath: 'digilog/v1/site-1/area-1/ahu-1/filter-1' },
        { token: 'tok-B', unsPath: 'digilog/v1/site-1/area-1/ahu-1/filter-2' },
      ],
      adminPassword: ADMIN_PW,
    });
    expect(result.clients).toHaveLength(3); // admin + 2 devices
    const deviceA = result.clients.find((c) => c.username === 'tok-A');
    expect(deviceA?.roles).toEqual([
      { rolename: 'device-digilog-v1-site-1-area-1-ahu-1-filter-1-role' },
    ]);
    const deviceB = result.clients.find((c) => c.username === 'tok-B');
    expect(deviceB?.roles).toEqual([
      { rolename: 'device-digilog-v1-site-1-area-1-ahu-1-filter-2-role' },
    ]);
    // admin-role + 2 device roles
    expect(result.roles.map((r) => r.rolename)).toEqual([
      'admin-role',
      'device-digilog-v1-site-1-area-1-ahu-1-filter-1-role',
      'device-digilog-v1-site-1-area-1-ahu-1-filter-2-role',
    ]);
  });

  it('encodes admin password in Mosquitto $7$ PBKDF2-SHA512 format', async () => {
    const result = await generateDynamicSecurity({ devices: [], adminPassword: ADMIN_PW });
    const admin = result.clients[0];
    // $7$<iterations>$<base64-salt>$<base64-hash> — Mosquitto v2 dynsec format.
    // 64-byte SHA-512 dk → 88 base64 chars (with padding); 12-byte salt → 16.
    // 64-byte salt → 88 base64 chars (last 4 always == padding); 64-byte hash → same.
    expect(admin.encoded_password).toMatch(/^\$7\$1000\$[A-Za-z0-9+/]{86}==\$[A-Za-z0-9+/]{86}==$/);
  });

  it('emits 5 publish + 8 subscribe + 8 receive ACLs per device', async () => {
    const unsPath = 'digilog/v1/site-1/area-1/ahu-1/filter-1';
    const result = await generateDynamicSecurity({
      devices: [{ token: 'tok-A', unsPath }],
      adminPassword: ADMIN_PW,
    });
    const deviceRole = result.roles.find((r) =>
      r.rolename === 'device-digilog-v1-site-1-area-1-ahu-1-filter-1-role'
    );
    expect(deviceRole).toBeDefined();
    expect(deviceRole!.acls.filter((a) => a.acltype === 'publishClientSend')).toHaveLength(5);
    expect(
      deviceRole!.acls.filter(
        (a) => a.acltype === 'subscribeLiteral' || a.acltype === 'subscribePattern'
      )
    ).toHaveLength(8);
    // 8 receive ACLs mirror the subscribe set so Mosquitto actually
    // delivers messages (subscribe alone is not enough under default-deny
    // publishClientReceive).
    expect(
      deviceRole!.acls.filter((a) => a.acltype === 'publishClientReceive')
    ).toHaveLength(8);
  });

  it('admin role grants publishClientReceive on # so server can consume all topics', async () => {
    const result = await generateDynamicSecurity({ devices: [], adminPassword: ADMIN_PW });
    const adminRole = result.roles.find((r) => r.rolename === 'admin-role')!;
    const receiveAll = adminRole.acls.find(
      (a) => a.acltype === 'publishClientReceive' && a.topic === '#',
    );
    expect(receiveAll).toBeDefined();
    expect(receiveAll!.allow).toBe(true);
  });

  it('uses subscribePattern for # wildcards and subscribeLiteral for exact topics', async () => {
    const unsPath = 'digilog/v1/site-1/area-1/ahu-1/filter-1';
    const result = await generateDynamicSecurity({
      devices: [{ token: 'tok-A', unsPath }],
      adminPassword: ADMIN_PW,
    });
    const deviceRole = result.roles.find((r) =>
      r.rolename === 'device-digilog-v1-site-1-area-1-ahu-1-filter-1-role'
    )!;
    for (const acl of deviceRole.acls) {
      if (acl.acltype === 'subscribeLiteral') {
        expect(acl.topic).not.toContain('#');
        expect(acl.topic).not.toContain('+');
      }
      if (acl.acltype === 'subscribePattern') {
        expect(acl.topic.includes('#') || acl.topic.includes('+')).toBe(true);
      }
    }
    // admin role's '#' subscribe must be subscribePattern, not literal
    const adminRole = result.roles.find((r) => r.rolename === 'admin-role')!;
    const adminSub = adminRole.acls.find((a) => a.topic === '#' && a.acltype !== 'publishClientSend');
    expect(adminSub?.acltype).toBe('subscribePattern');
  });

  it('defaultACLAccess denies all four operations', async () => {
    const result = await generateDynamicSecurity({ devices: [], adminPassword: ADMIN_PW });
    expect(result.defaultACLAccess).toEqual({
      publishClientSend: false,
      publishClientReceive: false,
      subscribe: false,
      unsubscribe: false,
    });
  });

  it('throws on empty adminPassword', async () => {
    await expect(
      generateDynamicSecurity({ devices: [], adminPassword: '' })
    ).rejects.toThrow(/adminPassword must be a non-empty string/);
  });

  it('throws on adminPassword shorter than 12 chars', async () => {
    await expect(
      generateDynamicSecurity({ devices: [], adminPassword: 'short-pw' })
    ).rejects.toThrow(/at least 12 characters/);
  });

  it('throws on duplicate unsPath between devices', async () => {
    await expect(
      generateDynamicSecurity({
        devices: [
          { token: 'tok-A', unsPath: 'digilog/v1/site-1/area-1/ahu-1/filter-1' },
          { token: 'tok-B', unsPath: 'digilog/v1/site-1/area-1/ahu-1/filter-1' },
        ],
        adminPassword: ADMIN_PW,
      })
    ).rejects.toThrow(/Duplicate device\.unsPath/);
  });

  it('throws on duplicate token between devices', async () => {
    await expect(
      generateDynamicSecurity({
        devices: [
          { token: 'tok-A', unsPath: 'digilog/v1/site-1/area-1/ahu-1/filter-1' },
          { token: 'tok-A', unsPath: 'digilog/v1/site-1/area-1/ahu-1/filter-2' },
        ],
        adminPassword: ADMIN_PW,
      })
    ).rejects.toThrow(/Duplicate device\.token/);
  });

  it('throws on empty device.token', async () => {
    await expect(
      generateDynamicSecurity({
        devices: [{ token: '', unsPath: 'digilog/v1/site-1/area-1/ahu-1/filter-1' }],
        adminPassword: ADMIN_PW,
      })
    ).rejects.toThrow(/device\.token must be a non-empty string/);
  });

  it('throws on empty device.unsPath', async () => {
    await expect(
      generateDynamicSecurity({
        devices: [{ token: 'tok-A', unsPath: '' }],
        adminPassword: ADMIN_PW,
      })
    ).rejects.toThrow(/device\.unsPath must be a non-empty string/);
  });
});
