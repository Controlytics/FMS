/**
 * MQTT Client — Connects to the configured MQTT broker using mqtt.js.
 * Subscribes to digilog/v1/# with QoS 1 and hands messages to mqtt-handler.
 * Exports singleton: getMqttClient(), initMqttClient(), closeMqttClient()
 *
 * Broker selection follows the USE_MOSQUITTO feature flag:
 *   - USE_MOSQUITTO=true  → Mosquitto: username 'admin', password from
 *                          MOSQUITTO_ADMIN_PASSWORD. The 'admin' client is
 *                          minted by mosquitto-acl-generator with '#' ACLs.
 *   - USE_MOSQUITTO=false → EMQX (legacy): username '__server__digilog',
 *                          password from EMQX_ADMIN_PASSWORD.
 */

import mqtt from 'mqtt';
import type { MqttClient } from 'mqtt';
import { handleMqttMessage } from './mqtt-handler.js';
import { isFeatureEnabled, FEATURE_FLAGS } from '../lib/feature-flags.js';

const UNS_ROOT = process.env.UNS_ROOT_PREFIX ?? 'digilog/v1';

let client: MqttClient | null = null;
let isInitialized = false;

/**
 * Get the current MQTT client instance.
 * Returns null if not yet initialized.
 */
export function getMqttClient(): MqttClient | null {
  return client;
}

/**
 * Initialize the MQTT client and connect to the EMQX broker.
 * Should be called after the HTTP server starts listening.
 */
export async function initMqttClient(): Promise<void> {
  if (isInitialized) return;

  const enabled = process.env.MQTT_ENABLED ?? 'false';
  if (enabled !== 'true') {
    console.info('[MQTT] MQTT is disabled (MQTT_ENABLED != true). Skipping initialization.');
    return;
  }

  const host = process.env.MQTT_BROKER_HOST ?? 'localhost';
  const port = parseInt(process.env.MQTT_BROKER_PORT ?? '1883', 10);
  const useMosquitto = isFeatureEnabled(FEATURE_FLAGS.USE_MOSQUITTO);
  const username = useMosquitto ? 'admin' : '__server__digilog';
  const password = useMosquitto
    ? (process.env.MOSQUITTO_ADMIN_PASSWORD ?? '')
    : (process.env.EMQX_ADMIN_PASSWORD ?? '');
  const brokerName = useMosquitto ? 'Mosquitto' : 'EMQX';

  const brokerUrl = `mqtt://${host}:${port}`;

  return new Promise<void>((resolve, reject) => {
    client = mqtt.connect(brokerUrl, {
      clientId: 'digilog-server',
      username,
      password,
      clean: false,
      reconnectPeriod: 5000,
      connectTimeout: 10000,
      properties: {
        sessionExpiryInterval: 300,
      },
    });

    client.on('connect', () => {
      console.info(`[MQTT] Connected to ${brokerName} broker at ${brokerUrl}`);
      isInitialized = true;

      // Subscribe to all UNS topics
      client!.subscribe(`${UNS_ROOT}/#`, { qos: 1 }, (err, granted) => {
        if (err) {
          console.error('[MQTT] Failed to subscribe:', err.message);
        } else {
          console.info(`[MQTT] Subscribed to ${UNS_ROOT}/# →`, granted);
        }
      });

      resolve();
    });

    client.on('message', (topic: string, payload: Buffer) => {
      handleMqttMessage(topic, payload).catch((err) => {
        console.error('[MQTT] Error handling message:', err);
      });
    });

    client.on('reconnect', () => {
      console.info('[MQTT] Reconnecting to broker...');
    });

    client.on('error', (err) => {
      console.error(`[MQTT] ${brokerName} connection error:`, err.message);
      if (!isInitialized) {
        // Don't reject — allow server to start without MQTT
        console.warn(`[MQTT] Failed to connect to ${brokerName} on init, server will retry.`);
        isInitialized = true; // Prevent re-init attempts
        resolve();
      }
    });

    client.on('close', () => {
      console.info('[MQTT] Connection closed');
    });

    client.on('offline', () => {
      console.warn('[MQTT] Client is offline');
    });

    // Timeout if connection takes too long — still resolve to not block server
    setTimeout(() => {
      if (!isInitialized) {
        console.warn(`[MQTT] ${brokerName} connection timeout — server continuing without MQTT.`);
        isInitialized = true;
        resolve();
      }
    }, 15000);
  });
}

/**
 * Close the MQTT client connection gracefully.
 */
export async function closeMqttClient(): Promise<void> {
  if (client) {
    return new Promise<void>((resolve) => {
      client!.end(false, {}, () => {
        console.info('[MQTT] Client disconnected');
        client = null;
        isInitialized = false;
        resolve();
      });
    });
  }
}
