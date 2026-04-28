/**
 * Mosquitto Dynamic Security generator — pure function that translates DigiLog
 * device-token state into a Mosquitto v2 dynamic-security JSON document.
 * Replaces EMQX HTTP webhook auth with Mosquitto's built-in dynsec plugin so
 * the broker can authenticate and authorize clients without an external service.
 */

import bcrypt from 'bcrypt';

interface Device {
  token: string;
  entityId: string;
}

interface Input {
  devices: Device[];
  adminPassword: string;
}

interface Role {
  rolename: string;
  acls: { acltype: 'publishClientSend' | 'publishClientReceive' | 'subscribeLiteral'; topic: string; allow: boolean }[];
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

export function generateDynamicSecurity(input: Input): DynamicSecurityConfig {
  const adminHash = bcrypt.hashSync(input.adminPassword, 10);
  const clients: Client[] = [
    { username: 'admin', password: adminHash, roles: [{ rolename: 'admin-role' }] },
  ];
  const roles: Role[] = [
    {
      rolename: 'admin-role',
      acls: [{ acltype: 'publishClientSend', topic: '#', allow: true }, { acltype: 'subscribeLiteral', topic: '#', allow: true }],
    },
  ];
  for (const device of input.devices) {
    const roleName = `device-${device.entityId}-role`;
    roles.push({
      rolename: roleName,
      acls: [
        { acltype: 'publishClientSend', topic: `digilog/v1/${device.entityId}/+`, allow: true },
        { acltype: 'subscribeLiteral', topic: `digilog/v1/${device.entityId}/cmd/+`, allow: true },
      ],
    });
    const tokenHash = bcrypt.hashSync(device.token, 10);
    clients.push({ username: device.token, password: tokenHash, roles: [{ rolename: roleName }] });
  }
  return {
    clients,
    groups: [],
    roles,
    defaultACLAccess: { publishClientSend: false, publishClientReceive: false, subscribe: false, unsubscribe: false },
  };
}
