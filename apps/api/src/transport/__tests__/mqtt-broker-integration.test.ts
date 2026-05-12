/**
 * MQTT broker integration test.
 *
 * Uses `aedes` (pure-JS MQTT broker) as a test double for Mosquitto.
 * Verifies that the production `mqtt.js` client connects, authenticates
 * using username+password (the same shape Mosquitto's dynamic-security
 * plugin enforces), and round-trips a publish/subscribe.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Aedes } from 'aedes';
import { createServer, type AddressInfo } from 'node:net';
import mqtt from 'mqtt';

describe('mqtt broker integration', () => {
  let aedes: Aedes;
  let server: ReturnType<typeof createServer>;
  let port: number;

  beforeAll(async () => {
    aedes = await Aedes.createBroker();
    aedes.authenticate = (_client, username, password, done) => {
      const ok = username === 'tok-A' && password?.toString() === 'pwd-A';
      done(null, ok);
    };
    server = createServer(aedes.handle as never);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  }, 10_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => aedes.close(resolve));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('rejects unknown credentials', async () => {
    const client = mqtt.connect(`mqtt://127.0.0.1:${port}`, {
      username: 'unknown',
      password: 'wrong',
      reconnectPeriod: 0,
      connectTimeout: 3_000,
    });

    const result = await new Promise<'connect' | 'error'>((resolve) => {
      const settle = (kind: 'connect' | 'error') => {
        client.removeAllListeners();
        resolve(kind);
      };
      client.once('connect', () => settle('connect'));
      client.once('error', () => settle('error'));
    });

    expect(result).toBe('error');
    expect(client.connected).toBe(false);
    client.end(true);
  });

  it('accepts valid credentials', async () => {
    const client = mqtt.connect(`mqtt://127.0.0.1:${port}`, {
      username: 'tok-A',
      password: 'pwd-A',
      reconnectPeriod: 0,
      connectTimeout: 3_000,
    });

    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => {
        client.removeAllListeners();
        reject(err);
      };
      client.once('connect', () => {
        client.removeAllListeners('error');
        resolve();
      });
      client.once('error', onError);
    });

    expect(client.connected).toBe(true);
    await new Promise<void>((resolve) => client.end(true, undefined, () => resolve()));
  });

  it('round-trips a publish/subscribe between two authenticated clients', async () => {
    const subscriber = mqtt.connect(`mqtt://127.0.0.1:${port}`, {
      username: 'tok-A',
      password: 'pwd-A',
      reconnectPeriod: 0,
      connectTimeout: 3_000,
    });
    const publisher = mqtt.connect(`mqtt://127.0.0.1:${port}`, {
      username: 'tok-A',
      password: 'pwd-A',
      reconnectPeriod: 0,
      connectTimeout: 3_000,
    });

    const TOPIC = 'digilog/v1/test/telemetry';
    const PAYLOAD = JSON.stringify({ cpu: 0.42 });

    const waitForConnect = (client: mqtt.MqttClient) =>
      new Promise<void>((resolve, reject) => {
        if (client.connected) return resolve();
        const onError = (err: Error) => {
          client.removeListener('connect', onConnect);
          reject(err);
        };
        const onConnect = () => {
          client.removeListener('error', onError);
          resolve();
        };
        client.once('connect', onConnect);
        client.once('error', onError);
      });

    await Promise.all([waitForConnect(subscriber), waitForConnect(publisher)]);

    const received = new Promise<{ topic: string; payload: string }>((resolve, reject) => {
      subscriber.once('error', reject);
      subscriber.on('message', (topic, payload) => {
        resolve({ topic, payload: payload.toString() });
      });
    });

    await new Promise<void>((resolve, reject) => {
      subscriber.subscribe(TOPIC, { qos: 1 }, (err) => (err ? reject(err) : resolve()));
    });

    await new Promise<void>((resolve, reject) => {
      publisher.publish(TOPIC, PAYLOAD, { qos: 1 }, (err) => (err ? reject(err) : resolve()));
    });

    const result = await received;
    expect(result.topic).toBe(TOPIC);
    expect(result.payload).toBe(PAYLOAD);

    await Promise.all([
      new Promise<void>((r) => subscriber.end(true, undefined, () => r())),
      new Promise<void>((r) => publisher.end(true, undefined, () => r())),
    ]);
  }, 10_000);
});
