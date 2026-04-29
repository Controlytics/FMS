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
 * Note: this generator is **not** deterministic. PBKDF2 salts each call, so
 * identical input yields different password hashes on every run. Callers that
 * diff the existing dynsec file before writing should compare on
 * `(username, roles[].rolename)` rather than the full JSON document.
 *
 * Password format: Mosquitto v2's dynamic-security plugin reads `encoded_password`
 * in the form `$7$<iterations>$<base64-salt>$<base64-hash>` (PBKDF2-SHA512,
 * 64-byte derived key, base64 padded). bcrypt is NOT supported by the dynsec
 * plugin even though Mosquitto links libcrypt — only its own `$7$` format works.
 * Reference: `mosquitto_ctrl dynsec init` reproduces this exact shape.
 */

import { pbkdf2Sync, randomBytes } from 'node:crypto';

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
  encoded_password: string;
  roles: { rolename: string }[];
}

export interface DynamicSecurityConfig {
  clients: Client[];
  groups: never[];
  roles: Role[];
  defaultACLAccess: { publishClientSend: boolean; publishClientReceive: boolean; subscribe: boolean; unsubscribe: boolean };
}

// PBKDF2 parameters MUST match what Mosquitto's mosquitto_passwd / mosquitto_ctrl
// dynsec init writes — verified empirically on Mosquitto 2.1.2 Windows: 1000
// iterations, 64-byte salt, 64-byte SHA-512 derived key. The dynsec plugin
// reads the iteration count and salt length from the field, but the in-tree
// tools always emit these values; staying consistent avoids surprises and
// keeps our hashes bit-identical in shape to what an operator would generate
// with mosquitto_passwd for debugging.
const PBKDF2_ITERATIONS = 1000;
const PBKDF2_SALT_BYTES = 64;
const PBKDF2_KEY_BYTES = 64;
const PBKDF2_DIGEST = 'sha512';
const MIN_ADMIN_PASSWORD_LEN = 12;

function encodePassword(plaintext: string): string {
  const salt = randomBytes(PBKDF2_SALT_BYTES);
  const hash = pbkdf2Sync(plaintext, salt, PBKDF2_ITERATIONS, PBKDF2_KEY_BYTES, PBKDF2_DIGEST);
  return `$7$${PBKDF2_ITERATIONS}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

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
    // Receive ACLs — Mosquitto's defaultACLAccess.publishClientReceive=false
    // would otherwise silently drop server→device deliveries. Subscribe alone
    // is not enough: subscribe controls the broker's accept of SUBSCRIBE,
    // publishClientReceive controls whether matching messages are actually
    // delivered. Mirror the subscribe topics so the device can both subscribe
    // and receive on rpc/request, attributes/shared, config, and ota.
    { acltype: 'publishClientReceive', topic: `${unsPath}/rpc/request`, allow: true },
    { acltype: 'publishClientReceive', topic: `${unsPath}/rpc/request/#`, allow: true },
    { acltype: 'publishClientReceive', topic: `${unsPath}/attributes/shared`, allow: true },
    { acltype: 'publishClientReceive', topic: `${unsPath}/attributes/shared/#`, allow: true },
    { acltype: 'publishClientReceive', topic: `${unsPath}/config`, allow: true },
    { acltype: 'publishClientReceive', topic: `${unsPath}/config/#`, allow: true },
    { acltype: 'publishClientReceive', topic: `${unsPath}/ota`, allow: true },
    { acltype: 'publishClientReceive', topic: `${unsPath}/ota/#`, allow: true },
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

  // -- Encode admin + all device tokens to Mosquitto $7$ format ---------------
  // pbkdf2Sync is synchronous + CPU-bound; with the default 101 iterations and
  // 14 devices it's <5 ms total, so we don't bother with the worker_threads
  // pbkdf2() variant. Salt is per-client so two devices with the same token
  // (which the dedupe check above already disallows) would still produce
  // different hashes.
  const adminEncoded = encodePassword(input.adminPassword);
  const deviceEncoded = input.devices.map((d) => encodePassword(d.token));

  // -- Roles ------------------------------------------------------------------
  const roles: Role[] = [
    {
      rolename: 'admin-role',
      acls: [
        { acltype: 'publishClientSend', topic: '#', allow: true },
        { acltype: 'subscribePattern', topic: '#', allow: true },
        // Without publishClientReceive on '#', Mosquitto silently drops
        // every device→admin message even though the subscribe was accepted.
        // The API is the admin client and consumes everything under digilog/v1/#
        // for ingestion; this grant is what makes that consumption work.
        { acltype: 'publishClientReceive', topic: '#', allow: true },
      ],
    },
  ];

  // -- Clients ----------------------------------------------------------------
  const clients: Client[] = [
    { username: 'admin', encoded_password: adminEncoded, roles: [{ rolename: 'admin-role' }] },
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
      encoded_password: deviceEncoded[i],
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
