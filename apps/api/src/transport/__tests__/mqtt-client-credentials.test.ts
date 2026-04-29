/**
 * mqtt-client credential-selection tests.
 *
 * Verifies that initMqttClient picks the right (username, password) pair
 * based on the USE_MOSQUITTO feature flag:
 *   - flag=true  → admin / MOSQUITTO_ADMIN_PASSWORD
 *   - flag=false → __server__digilog / EMQX_ADMIN_PASSWORD
 *   - unset      → EMQX path (default off)
 *
 * Mosquitto's dynamic-security generator mints an 'admin' client with '#'
 * publish + subscribe ACLs, so the API connects as 'admin' under that
 * broker; under EMQX (legacy) the API used a dedicated '__server__digilog'
 * client minted by the HTTP webhook.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { mockMqttClient, mockMqttConnect } = vi.hoisted(() => {
  const mockMqttClient = {
    on: vi.fn(),
    subscribe: vi.fn(),
    end: vi.fn(),
  };
  return { mockMqttClient, mockMqttConnect: vi.fn(() => mockMqttClient) };
});

vi.mock('mqtt', () => ({
  default: { connect: mockMqttConnect },
  connect: mockMqttConnect,
}));

vi.mock('../mqtt-handler.js', () => ({
  handleMqttMessage: vi.fn(),
}));

type EnvSnapshot = {
  MQTT_ENABLED?: string;
  USE_MOSQUITTO?: string;
  MOSQUITTO_ADMIN_PASSWORD?: string;
  EMQX_ADMIN_PASSWORD?: string;
};

let snapshot: EnvSnapshot;

function takeSnapshot(): EnvSnapshot {
  return {
    MQTT_ENABLED: process.env.MQTT_ENABLED,
    USE_MOSQUITTO: process.env.USE_MOSQUITTO,
    MOSQUITTO_ADMIN_PASSWORD: process.env.MOSQUITTO_ADMIN_PASSWORD,
    EMQX_ADMIN_PASSWORD: process.env.EMQX_ADMIN_PASSWORD,
  };
}

function restoreSnapshot(s: EnvSnapshot) {
  for (const [key, value] of Object.entries(s)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function setupConnectStub() {
  // Resolve initMqttClient by simulating the broker connect event.
  mockMqttClient.on.mockImplementation((event: string, cb: Function) => {
    if (event === 'connect') {
      setTimeout(() => cb(), 0);
    }
  });
  mockMqttClient.subscribe.mockImplementation((_topic: string, _opts: any, cb: Function) => {
    cb(null, [{ topic: 'digilog/v1/#', qos: 1 }]);
  });
}

describe('mqtt-client credential selection', () => {
  beforeEach(() => {
    snapshot = takeSnapshot();
    vi.clearAllMocks();
    vi.resetModules();
    setupConnectStub();
    process.env.MQTT_ENABLED = 'true';
  });

  afterEach(() => {
    restoreSnapshot(snapshot);
  });

  it('USE_MOSQUITTO=true → admin / MOSQUITTO_ADMIN_PASSWORD', async () => {
    process.env.USE_MOSQUITTO = 'true';
    process.env.MOSQUITTO_ADMIN_PASSWORD = 'mosquitto-secret-123';
    process.env.EMQX_ADMIN_PASSWORD = 'should-not-be-used';

    const { initMqttClient } = await import('../mqtt-client.js');
    await initMqttClient();

    expect(mockMqttConnect).toHaveBeenCalledTimes(1);
    const opts = mockMqttConnect.mock.calls[0]![1] as { username: string; password: string };
    expect(opts.username).toBe('admin');
    expect(opts.password).toBe('mosquitto-secret-123');
  });

  it('USE_MOSQUITTO=false → __server__digilog / EMQX_ADMIN_PASSWORD', async () => {
    process.env.USE_MOSQUITTO = 'false';
    process.env.MOSQUITTO_ADMIN_PASSWORD = 'should-not-be-used';
    process.env.EMQX_ADMIN_PASSWORD = 'emqx-secret-abc';

    const { initMqttClient } = await import('../mqtt-client.js');
    await initMqttClient();

    expect(mockMqttConnect).toHaveBeenCalledTimes(1);
    const opts = mockMqttConnect.mock.calls[0]![1] as { username: string; password: string };
    expect(opts.username).toBe('__server__digilog');
    expect(opts.password).toBe('emqx-secret-abc');
  });

  it('USE_MOSQUITTO unset → defaults to EMQX path', async () => {
    delete process.env.USE_MOSQUITTO;
    delete process.env.MOSQUITTO_ADMIN_PASSWORD;
    process.env.EMQX_ADMIN_PASSWORD = 'emqx-default-xyz';

    const { initMqttClient } = await import('../mqtt-client.js');
    await initMqttClient();

    expect(mockMqttConnect).toHaveBeenCalledTimes(1);
    const opts = mockMqttConnect.mock.calls[0]![1] as { username: string; password: string };
    expect(opts.username).toBe('__server__digilog');
    expect(opts.password).toBe('emqx-default-xyz');
  });
});
