/**
 * Shared types for the device-snippet generators.
 *
 * Each language module exports a render function that takes a
 * `SnippetContext` + a transport variant and returns the snippet string.
 * The route handler in `connectivity/routes.ts` builds the context once
 * and dispatches through `renderSnippets()` in `./index.ts`.
 */
export type Transport = 'MQTT' | 'HTTP';

export interface SnippetContext {
  entityName: string;
  unsPath: string;
  token: string;
  apiUrl: string;
  /** Hostname extracted from apiUrl (no scheme, no port). MQTT only. */
  mqttHost: string;
  /** `${unsPath}/telemetry` — pre-computed for convenience. MQTT only. */
  telemetryTopic: string;
  /** `${unsPath}/attributes` — pre-computed for convenience. MQTT only. */
  attributesTopic: string;
}
