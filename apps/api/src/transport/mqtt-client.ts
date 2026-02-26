/**
 * MQTT Client — Connects to the EMQX broker using mqtt.js.
 * Subscribes to digilog/v1/# with QoS 1 and hands messages to mqtt-handler.
 * Exports singleton: getMqttClient(), initMqttClient(), closeMqttClient()
 */

import mqtt from 'mqtt';
import type { MqttClient } from 'mqtt';
import { handleMqttMessage } from './mqtt-handler.js';

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
    console.log('[MQTT] MQTT is disabled (MQTT_ENABLED != true). Skipping initialization.');
    return;
  }

  const host = process.env.MQTT_BROKER_HOST ?? 'localhost';
  const port = parseInt(process.env.MQTT_BROKER_PORT ?? '1883', 10);
  const username = '__server__digilog';
  const password = process.env.EMQX_ADMIN_PASSWORD ?? '';

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
      console.log(`[MQTT] Connected to broker at ${brokerUrl}`);
      isInitialized = true;

      // Subscribe to all UNS topics
      client!.subscribe(`${UNS_ROOT}/#`, { qos: 1 }, (err, granted) => {
        if (err) {
          console.error('[MQTT] Failed to subscribe:', err.message);
        } else {
          console.log(`[MQTT] Subscribed to ${UNS_ROOT}/# →`, granted);
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
      console.log('[MQTT] Reconnecting to broker...');
    });

    client.on('error', (err) => {
      console.error('[MQTT] Client error:', err.message);
      if (!isInitialized) {
        // Don't reject — allow server to start without MQTT
        console.warn('[MQTT] Failed to connect on init, server will retry.');
        isInitialized = true; // Prevent re-init attempts
        resolve();
      }
    });

    client.on('close', () => {
      console.log('[MQTT] Connection closed');
    });

    client.on('offline', () => {
      console.log('[MQTT] Client is offline');
    });

    // Timeout if connection takes too long — still resolve to not block server
    setTimeout(() => {
      if (!isInitialized) {
        console.warn('[MQTT] Connection timeout — server continuing without MQTT.');
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
        console.log('[MQTT] Client disconnected');
        client = null;
        isInitialized = false;
        resolve();
      });
    });
  }
}
