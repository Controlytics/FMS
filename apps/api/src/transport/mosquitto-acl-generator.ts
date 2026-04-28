/**
 * Mosquitto Dynamic Security generator — pure function that translates DigiLog
 * device-token state into a Mosquitto v2 dynamic-security JSON document.
 * Replaces EMQX HTTP webhook auth with Mosquitto's built-in dynsec plugin so
 * the broker can authenticate and authorize clients without an external service.
 *
 * Topic taxonomy mirrors the existing EMQX webhook auth at
 * `apps/api/src/transport/mqtt-auth-routes.ts` (lines 224-265). Each device is
 * keyed by its authoritative UNS path (e.g.
 * `digilog/v1/site-1/area-1/ahu-1/filter-1`); per-device roles emit:
 *   - publish ACLs:   <unsPath>/{telemetry,attributes,events}, <unsPath>/rpc/response/#, <unsPath>/binary/#
 *   - subscribe ACLs: <unsPath>/{rpc/request,attributes/shared,config,ota} plus their `/#` wildcards
 * Wildcarded subscribe topics use `subscribePattern`; exact-match subscribe
 * topics use `subscribeLiteral` (a literal subscribe ACL would otherwise match
 * the `#` character itself, not the wildcard).
 *
 * Note: this generator is **not** deterministic. bcrypt salts each call, so
 * identical input yields different password hashes on every run. Callers that
 * diff the existing dynsec file before writing should compare on
 * `(username, roles[].rolename)` rather than the full JSON document.
 */

import bcrypt from 'bcrypt';

interface Device {
  token: string;
  unsPath: string;
}

interface Input {
  devices: Device[];
  adminPassword: string;
}

interface Role {
  rolename: string;
  acls: {
    acltype: 'publishClientSend' | 'publishClientReceive' | 'subscribeLiteral' | 'subscribePattern';
    topic: string;
    allow: boolean;
  }[];
}

interface Client {
  username: string;
  password: string;
  roles: { rolename: string }[];
}

export interface DynamicSecurityConfig {
  clients: Client[];
  groups: never[];
  roles: Role[];
  defaultACLAccess: { publishClientSend: boolean; publishClientReceive: boolean; subscribe: boolean; unsubscribe: boolean };
}

const BCRYPT_COST = 10;
const MIN_ADMIN_PASSWORD_LEN = 12;

function buildDeviceAcls(unsPath: string): Role['acls'] {
  return [
    // Publish ACLs (mirrors mqtt-auth-routes.ts allowedPublishSuffixes)
    { acltype: 'publishClientSend', topic: `${unsPath}/telemetry`, allow: true },
    { acltype: 'publishClientSend', topic: `${unsPath}/attributes`, allow: true },
    { acltype: 'publishClientSend', topic: `${unsPath}/events`, allow: true },
    { acltype: 'publishClientSend', topic: `${unsPath}/rpc/response/#`, allow: true },
    { acltype: 'publishClientSend', topic: `${unsPath}/binary/#`, allow: true },
    // Subscribe ACLs (mirrors mqtt-auth-routes.ts allowedSubscribeSuffixes)
    { acltype: 'subscribeLiteral', topic: `${unsPath}/rpc/request`, allow: true },
    { acltype: 'subscribePattern', topic: `${unsPath}/rpc/request/#`, allow: true },
    { acltype: 'subscribeLiteral', topic: `${unsPath}/attributes/shared`, allow: true },
    { acltype: 'subscribePattern', topic: `${unsPath}/attributes/shared/#`, allow: true },
    { acltype: 'subscribeLiteral', topic: `${unsPath}/config`, allow: true },
    { acltype: 'subscribePattern', topic: `${unsPath}/config/#`, allow: true },
    { acltype: 'subscribeLiteral', topic: `${unsPath}/ota`, allow: true },
    { acltype: 'subscribePattern', topic: `${unsPath}/ota/#`, allow: true },
  ];
}

export async function generateDynamicSecurity(input: Input): Promise<DynamicSecurityConfig> {
  // -- Input validation -------------------------------------------------------
  if (typeof input.adminPassword !== 'string' || input.adminPassword.length === 0) {
    throw new Error('adminPassword must be a non-empty string');
  }
  if (input.adminPassword.length < MIN_ADMIN_PASSWORD_LEN) {
    throw new Error(`adminPassword must be at least ${MIN_ADMIN_PASSWORD_LEN} characters`);
  }

  const seenTokens = new Set<string>();
  const seenUnsPaths = new Set<string>();
  for (const device of input.devices) {
    if (typeof device.token !== 'string' || device.token.length === 0) {
      throw new Error('device.token must be a non-empty string');
    }
    if (typeof device.unsPath !== 'string' || device.unsPath.length === 0) {
      throw new Error('device.unsPath must be a non-empty string');
    }
    if (seenTokens.has(device.token)) {
      throw new Error(`Duplicate device.token detected: ${device.token}`);
    }
    if (seenUnsPaths.has(device.unsPath)) {
      throw new Error(`Duplicate device.unsPath detected: ${device.unsPath}`);
    }
    seenTokens.add(device.token);
    seenUnsPaths.add(device.unsPath);
  }

  // -- Hash admin + all device tokens in parallel -----------------------------
  const [adminHash, deviceHashes] = await Promise.all([
    bcrypt.hash(input.adminPassword, BCRYPT_COST),
    Promise.all(input.devices.map((d) => bcrypt.hash(d.token, BCRYPT_COST))),
  ]);

  // -- Roles ------------------------------------------------------------------
  const roles: Role[] = [
    {
      rolename: 'admin-role',
      acls: [
        { acltype: 'publishClientSend', topic: '#', allow: true },
        { acltype: 'subscribePattern', topic: '#', allow: true },
      ],
    },
  ];

  // -- Clients ----------------------------------------------------------------
  const clients: Client[] = [
    { username: 'admin', password: adminHash, roles: [{ rolename: 'admin-role' }] },
  ];

  for (let i = 0; i < input.devices.length; i++) {
    const device = input.devices[i];
    // Mosquitto role names should not contain '/' — sanitize unsPath.
    const roleName = `device-${device.unsPath.replace(/\//g, '-')}-role`;
    roles.push({
      rolename: roleName,
      acls: buildDeviceAcls(device.unsPath),
    });
    clients.push({
      username: device.token,
      password: deviceHashes[i],
      roles: [{ rolename: roleName }],
    });
  }

  return {
    clients,
    groups: [],
    roles,
    defaultACLAccess: {
      publishClientSend: false,
      publishClientReceive: false,
      subscribe: false,
      unsubscribe: false,
    },
  };
}
