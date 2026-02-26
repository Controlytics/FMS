import { describe, it, expect, beforeEach, vi } from 'vitest';

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

describe('mqtt-client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('getMqttClient returns null before initialization', async () => {
    const { getMqttClient } = await import('../mqtt-client.js');
    expect(getMqttClient()).toBeNull();
  });

  it('initMqttClient skips when MQTT_ENABLED is not true', async () => {
    const originalEnv = process.env.MQTT_ENABLED;
    process.env.MQTT_ENABLED = 'false';
    const { initMqttClient } = await import('../mqtt-client.js');
    await initMqttClient();
    expect(mockMqttConnect).not.toHaveBeenCalled();
    process.env.MQTT_ENABLED = originalEnv;
  });

  it('initMqttClient connects when MQTT_ENABLED is true', async () => {
    const originalEnv = process.env.MQTT_ENABLED;
    process.env.MQTT_ENABLED = 'true';

    // Simulate connect event
    mockMqttClient.on.mockImplementation((event: string, cb: Function) => {
      if (event === 'connect') {
        setTimeout(() => cb(), 0);
      }
    });
    mockMqttClient.subscribe.mockImplementation((_topic: string, _opts: any, cb: Function) => {
      cb(null, [{ topic: 'digilog/v1/#', qos: 1 }]);
    });

    const { initMqttClient } = await import('../mqtt-client.js');
    await initMqttClient();
    expect(mockMqttConnect).toHaveBeenCalled();

    process.env.MQTT_ENABLED = originalEnv;
  });

  it('closeMqttClient is safe to call when not initialized', async () => {
    const { closeMqttClient } = await import('../mqtt-client.js');
    await closeMqttClient();
    // Should not throw
  });
});
