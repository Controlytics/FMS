/**
 * Windows-server-stack end-to-end integration suite (Phase 5, Task 5.1).
 *
 * Verifies the post-rewrite stack works as a coherent whole:
 *   1. Phase 0  — Fastify boots in-process via the existing e2e test helper
 *   2. Phase 1  — MQTT ingestion via aedes (in-process Mosquitto stand-in)
 *   3. Phase 2  — graphile-worker (Postgres-backed) enqueue + dispatch
 *   4. Phase 3  — puppeteer-core + Edge + @napi-rs/canvas PDF render
 *
 * Gating
 *   The whole suite is gated on `INTEGRATION_TEST=1`. A normal
 *   `npx vitest run` from the repo root therefore registers the suites as
 *   skipped and exits clean — we never accidentally hit Postgres / Mosquitto
 *   / Edge in CI.
 *
 * Real infra
 *   When the gate is on, this suite hits the same `digilog_db` and
 *   `digilog_tsdb` the dev stack uses. No mocks. Cleanup runs in `afterAll`
 *   keyed by a per-run UUID so leftover rows from a crash don't pollute the
 *   next dev run. Cleanup steps log their failures rather than swallow them
 *   (per CLAUDE.md "Never swallow exceptions") so a partial-cleanup state is
 *   visible in CI logs.
 *
 * Out of scope (per task spec)
 *   - The pre-existing ts_telemetry Stage-9 write-loss issue. If the MQTT
 *     pipeline never lands rows in `ts_telemetry` we surface a diagnostic
 *     and let the assertion fail; the root cause is a separate investigation.
 *   - Orphan UNS mapping cleanup.
 *   - CI wiring for `INTEGRATION_TEST=1`.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createServer, type AddressInfo, type Server } from 'node:net';
import { Aedes } from 'aedes';
import mqtt, { type MqttClient } from 'mqtt';
import { Pool } from 'pg';
import type { FastifyInstance } from 'fastify';

const GATED = process.env.INTEGRATION_TEST === '1';

// ─── Per-run marker ────────────────────────────────────────────────────────
// Every entity / mqtt topic / queue payload we create gets stamped with this
// UUID so cleanup in afterAll can safely DELETE only our rows. Computed at
// module load so all test cases agree.
const RUN_ID = randomUUID();
const ENTITY_NAME = `phase5-verify-${RUN_ID.slice(0, 8)}`;
const TEMPLATE_NAME = `phase5-tpl-${RUN_ID.slice(0, 8)}`;
const UNS_PATH = `digilog/v1/test/phase5/${RUN_ID.slice(0, 8)}`;
const MQTT_TOPIC = `${UNS_PATH}/telemetry`;

// The API's MQTT client identifies itself with this clientId in
// apps/api/src/transport/mqtt-client.ts:58. Keep in sync if that changes —
// CRITICAL 1 (subscribe handshake) depends on us recognising the API's
// SUBSCRIBE packet.
const API_MQTT_CLIENT_ID = 'digilog-server';

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Wait for a predicate up to `timeoutMs`, polling every `pollMs`. */
async function waitFor(
  predicate: () => Promise<boolean>,
  { timeoutMs = 30_000, pollMs = 250 }: { timeoutMs?: number; pollMs?: number } = {},
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return false;
}

// ─── Suite ────────────────────────────────────────────────────────────────

describe.skipIf(!GATED)('windows-server-stack (Phase 5 end-to-end)', () => {
  // Lazy imports so the file is parseable even when DB/queue env is missing
  // (we only resolve these inside `beforeAll`, which is itself skipped when
  // the gate is off — the bare describe.skipIf isn't enough because vitest
  // imports the module body unconditionally).
  let app: FastifyInstance;
  let prisma: import('@prisma/client').PrismaClient;
  let tsdb: Pool;

  // MQTT broker stand-in
  let aedes: Aedes;
  let brokerServer: Server;
  let brokerPort: number;

  // graphile-worker handles
  let runner: import('graphile-worker').Runner | null = null;
  let producer: import('graphile-worker').WorkerUtils | null = null;

  // DB fixture ids
  let orgId: string;
  let templateId: string;
  let entityId: string;
  let unsMappingId: string;

  // Buffer for Test 3 — populated by the phase5_verification_ping task.
  // Declared here (above beforeAll) so the closure inside startJobRunner
  // captures the correct binding at the point the task list is built.
  const phase5PingPayloads: unknown[] = [];

  // Track every MqttClient we create so afterAll can close them even if a
  // test throws mid-publish. IMPORTANT 2 — without this the publisher's TCP
  // socket leaks on assertion failure.
  const cleanupClients: MqttClient[] = [];

  beforeAll(async () => {
    // ─── 1. Boot test fixtures: DB, broker, runner ────────────────────────
    // Fail loud if the e2e env wasn't loaded — better to surface a
    // misconfiguration here than to silently fall back to magic strings
    // ('digilog123') and hit an opaque "password authentication failed"
    // 60 seconds into the suite. setupFiles loads apps/api/.env which
    // populates these.
    const requiredTsdbEnv = ['TSDB_HOST', 'TSDB_PORT', 'TSDB_DATABASE', 'TSDB_USER', 'TSDB_PASSWORD'];
    const missing = requiredTsdbEnv.filter((k) => !process.env[k]);
    if (missing.length > 0) {
      throw new Error(
        `[phase5-verify] Missing TSDB env vars: ${missing.join(', ')}. ` +
          `apps/api/.env not loaded? setupFiles in vitest.config.ts should populate these.`,
      );
    }

    const { PrismaClient } = await import('@prisma/client');
    prisma = new PrismaClient();
    tsdb = new Pool({
      host: process.env.TSDB_HOST,
      port: parseInt(process.env.TSDB_PORT!, 10),
      database: process.env.TSDB_DATABASE,
      user: process.env.TSDB_USER,
      password: process.env.TSDB_PASSWORD,
    });

    // ─── 2. Stand up an aedes broker on a random free port ────────────────
    aedes = await Aedes.createBroker();
    // Permissive auth — this is the in-process Mosquitto stand-in. The
    // production credential check is exercised in
    // apps/api/src/transport/__tests__/mqtt-broker-integration.test.ts.
    aedes.authenticate = (_client, _username, _password, done) => done(null, true);
    // `aedes.handle` is typed as `(stream, request?) => Client` (returns the
    // newly-attached aedes Client), while `node:net.createServer`'s connection
    // listener wants `(socket: Socket) => void`. Node ignores the return value
    // and aedes only reads the duplex stream, so the cast is safe; `as never`
    // is just the quietest way past the structural mismatch.
    brokerServer = createServer(aedes.handle as never);
    await new Promise<void>((resolve) =>
      brokerServer.listen(0, '127.0.0.1', () => resolve()),
    );
    brokerPort = (brokerServer.address() as AddressInfo).port;

    // Point the API's MQTT client (and every downstream consumer that reads
    // these env vars) at our in-process broker. This must happen BEFORE
    // initMqttClient() runs.
    process.env.MQTT_ENABLED = 'true';
    process.env.MQTT_BROKER_HOST = '127.0.0.1';
    process.env.MQTT_BROKER_PORT = String(brokerPort);
    process.env.UNS_ROOT_PREFIX = process.env.UNS_ROOT_PREFIX ?? 'digilog/v1';
    // Keep auth simple — aedes accepts anything; the production code path
    // sends username/password regardless of the USE_MOSQUITTO flag.
    process.env.MOSQUITTO_ADMIN_PASSWORD = process.env.MOSQUITTO_ADMIN_PASSWORD ?? 'integration-test';

    // ─── 3. Boot the in-process Fastify (same pattern as e2e/audit.test) ──
    const { buildApp } = (await import('../../apps/api/src/e2e/test-helper.js')) as {
      buildApp: () => Promise<FastifyInstance>;
    };
    app = await buildApp();

    // CRITICAL 1 — subscribe-handshake race. mqtt-client.ts resolves
    // initMqttClient() on the broker's CONNACK, but client.subscribe() is
    // fire-and-forget. Without this gate, our publisher's first messages
    // can hit aedes BEFORE the API's SUBSCRIBE / SUBACK round-trip
    // completes, and aedes silently drops them. Hook on the broker side and
    // wait for the API client's SUBSCRIBE packet, then proceed.
    const apiSubscribed = new Promise<void>((resolve) => {
      aedes.on('subscribe', (_subs, c: { id?: string } | null) => {
        if (c?.id === API_MQTT_CLIENT_ID) resolve();
      });
    });

    // Initialize the API's MQTT client — this is the post-Phase-1 swap path
    // (reads MQTT_BROKER_HOST/PORT, USE_MOSQUITTO, MOSQUITTO_ADMIN_PASSWORD).
    // We're verifying THAT plumbing, so we must drive it via the production
    // initMqttClient(), not bypass to handleMqttMessage directly.
    const { initMqttClient } = await import('../../apps/api/src/transport/mqtt-client.js');
    await initMqttClient();

    await Promise.race([
      apiSubscribed,
      new Promise<never>((_resolve, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `API client '${API_MQTT_CLIENT_ID}' never SUBSCRIBEd to MQTT broker within 5s`,
              ),
            ),
          5_000,
        ),
      ),
    ]);

    // Initialize the telemetry batcher so Stage 9 has somewhere to write.
    const { initTelemetryBatcher } = await import('../../packages/db/src/telemetry-batcher.js');
    initTelemetryBatcher(tsdb, { batchSize: 25, flushIntervalMs: 500 });

    // ─── 4. DB fixture: org + template + instance + UNS mapping ───────────
    // Minimal asset graph required by the ingestion pipeline — without these
    // mqtt-handler drops the message at the UnsMapping lookup.
    const existingOrg = await prisma.organization.findFirst({ select: { id: true } });
    if (!existingOrg) {
      throw new Error(
        'No Organization rows in digilog_db; cannot run Phase 5 integration suite. Seed the DB first.',
      );
    }
    orgId = existingOrg.id;

    // CRITICAL 2 — verified via grep: schema currently has NO FK from
    // asset_instances.template_version to asset_template_versions and no
    // trigger that auto-populates the join table. The production
    // createTemplate(...) service writes a row in asset_template_versions
    // for change-tracking, but it isn't enforced at the DB level. Direct
    // prisma.assetTemplate.create + prisma.assetInstance.create with
    // templateVersion: 1 is therefore safe; revisit this fixture if a FK
    // or trigger is added later.
    const template = await prisma.assetTemplate.create({
      data: {
        name: TEMPLATE_NAME,
        organizationId: orgId,
        category: 'Test',
        description: `Phase 5 verification template (run ${RUN_ID})`,
        dataIngestionEnabled: true,
        transportType: 'MQTT',
      },
    });
    templateId = template.id;

    const entity = await prisma.assetInstance.create({
      data: {
        name: ENTITY_NAME,
        organizationId: orgId,
        templateId,
        templateVersion: 1,
        unsPath: UNS_PATH,
        isActive: true,
      },
    });
    entityId = entity.id;

    const mapping = await prisma.unsMapping.create({
      data: {
        entityId,
        unsPath: UNS_PATH,
        pathSegments: { test: true, runId: RUN_ID } as never,
      },
    });
    unsMappingId = mapping.id;

    // ─── 5. graphile-worker: bootstrap schema, get producer ──────────────
    // We DON'T start the API's full job runner here — it's already started
    // implicitly by anything that reaches getProducer(), and we want a tight
    // task list for the Phase 2 verification test (a custom ping task).
    const { getProducer, startJobRunner } = await import('../../packages/queue/src/index.js');
    producer = await getProducer();
    // Boot a Runner that handles BOTH our ping task (Test 3) AND the real
    // ingestion task (Test 2 needs a consumer; the API's test-helper does
    // not start one). Single Runner per process — the queue package guards
    // against double-start.
    const { ingestionTask } = await import('../../apps/api/src/workers/ingestion.worker.js');
    runner = await startJobRunner({
      taskList: {
        ingestion: ingestionTask,
        // Custom verifier — see Test 3.
        phase5_verification_ping: async (payload, helpers) => {
          helpers.logger.info(`phase5 ping received: ${JSON.stringify(payload)}`);
          // No-op success — the test asserts that addJob → handler invocation works.
          phase5PingPayloads.push(payload);
        },
      },
      concurrency: 5,
    });
  }, 120_000);

  afterAll(async () => {
    // Close in reverse order: queue runner → mqtt clients → app → broker →
    // batcher → DB pools. Every step logs its own failure (CLAUDE.md
    // "Never swallow exceptions") but doesn't rethrow — we WANT the
    // remaining cleanup steps to run even if an earlier one bombs.

    try {
      const { stopJobRunner, closeProducer } = await import('../../packages/queue/src/index.js');
      await stopJobRunner();
      await closeProducer();
    } catch (err) {
      console.error('[phase5-cleanup] stop graphile-worker failed:', err);
    }

    // Close any MqttClient created by tests BEFORE we tear the broker down,
    // so each socket gets a clean disconnect rather than a half-open ECONNRESET.
    for (const client of cleanupClients) {
      try {
        await new Promise<void>((resolve) => client.end(true, undefined, () => resolve()));
      } catch (err) {
        console.error('[phase5-cleanup] close test mqtt client failed:', err);
      }
    }

    try {
      const { closeMqttClient } = await import('../../apps/api/src/transport/mqtt-client.js');
      await closeMqttClient();
    } catch (err) {
      console.error('[phase5-cleanup] closeMqttClient (API) failed:', err);
    }

    try {
      const { closeTelemetryBatcher } = await import(
        '../../packages/db/src/telemetry-batcher.js'
      );
      await closeTelemetryBatcher();
    } catch (err) {
      console.error('[phase5-cleanup] closeTelemetryBatcher failed:', err);
    }

    try {
      const { closeBrowser } = await import(
        '../../apps/api/src/modules/reports/renderers/pdf-renderer.js'
      );
      await closeBrowser();
    } catch (err) {
      console.error('[phase5-cleanup] closeBrowser (puppeteer) failed:', err);
    }

    if (app) {
      try {
        await app.close();
      } catch (err) {
        console.error('[phase5-cleanup] app.close() failed:', err);
      }
    }

    if (brokerServer) {
      try {
        await new Promise<void>((resolve) => brokerServer.close(() => resolve()));
      } catch (err) {
        console.error('[phase5-cleanup] brokerServer.close() failed:', err);
      }
    }
    if (aedes) {
      try {
        await new Promise<void>((resolve) => aedes.close(() => resolve()));
      } catch (err) {
        console.error('[phase5-cleanup] aedes.close() failed:', err);
      }
    }

    // ─── DB cleanup — only rows we created ────────────────────────────────
    if (prisma) {
      try {
        if (unsMappingId) {
          await prisma.unsMapping
            .delete({ where: { id: unsMappingId } })
            .catch((err: unknown) => {
              console.error('[phase5-cleanup] delete UnsMapping failed:', err);
            });
        }
        // ConnectivityStatus is upserted by mqtt-handler on first publish;
        // remove it too so the entity row can be deleted cleanly.
        if (entityId) {
          await prisma.connectivityStatus
            .deleteMany({ where: { entityId } })
            .catch((err: unknown) => {
              console.error('[phase5-cleanup] delete ConnectivityStatus failed:', err);
            });
          await prisma.deviceCredential
            .deleteMany({ where: { entityId } })
            .catch((err: unknown) => {
              console.error('[phase5-cleanup] delete DeviceCredential failed:', err);
            });
          await prisma.assetInstance
            .delete({ where: { id: entityId } })
            .catch((err: unknown) => {
              console.error('[phase5-cleanup] delete AssetInstance failed:', err);
            });
        }
        if (templateId) {
          await prisma.assetTemplate
            .delete({ where: { id: templateId } })
            .catch((err: unknown) => {
              console.error('[phase5-cleanup] delete AssetTemplate failed:', err);
            });
        }
      } finally {
        await prisma.$disconnect().catch((err: unknown) => {
          console.error('[phase5-cleanup] prisma.$disconnect() failed:', err);
        });
      }
    }

    // ts_telemetry rows for this entity — TimescaleDB blocks UPDATE/DELETE on
    // hypertables for digilog_app (init-tsdb.sql line 184). Skipping cleanup
    // is intentional: the rows are tiny and will eventually retention-cleanup
    // out, and we don't want to grant DELETE just for tests.
    if (tsdb) {
      try {
        await tsdb.end();
      } catch (err) {
        console.error('[phase5-cleanup] tsdb.end() failed:', err);
      }
    }
  }, 60_000);

  // ─── Test 1 — Boot API (Phase 0 sanity) ──────────────────────────────────
  it('API boots in test mode and serves /api/health', async () => {
    expect(app).toBeDefined();
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { status: string };
    expect(body.status).toBe('ok');
  });

  // ─── Test 2 — MQTT publish 100 + telemetry assert (Phase 1 + Stage 9) ──
  it('MQTT: 100 telemetry messages flow aedes → mqtt-handler → ts_telemetry', async () => {
    // Spin up a publisher client that talks to our aedes broker. mqtt.js is
    // the same library the API's mqtt-client uses; we're publishing as a
    // device, the API is subscribed via initMqttClient().
    const publisher: MqttClient = mqtt.connect(`mqtt://127.0.0.1:${brokerPort}`, {
      clientId: `phase5-publisher-${RUN_ID.slice(0, 8)}`,
      username: 'phase5-test',
      password: 'phase5-test',
      reconnectPeriod: 0,
      connectTimeout: 5_000,
    });
    // Register for cleanup BEFORE we await connect; if connect throws, the
    // socket may still be half-open and afterAll needs to drain it.
    cleanupClients.push(publisher);

    // IMPORTANT 2 — wrap the whole publish + assert path in try/finally so
    // the publisher's TCP socket is closed even if an assertion throws.
    try {
      await new Promise<void>((resolve, reject) => {
        publisher.once('connect', () => resolve());
        publisher.once('error', reject);
      });

      const MESSAGE_COUNT = 100;
      for (let i = 0; i < MESSAGE_COUNT; i++) {
        const payload = JSON.stringify({
          runId: RUN_ID,
          seq: i,
          temperature: 20 + (i % 10) * 0.5,
          ts: new Date().toISOString(),
        });
        await new Promise<void>((resolve, reject) => {
          publisher.publish(MQTT_TOPIC, payload, { qos: 1 }, (err) =>
            err ? reject(err) : resolve(),
          );
        });
      }

      // The pipeline writes to ts_telemetry via the batcher (flushIntervalMs
      // is 500ms in this suite). Give the queue + pipeline + batcher up to
      // 60s wall-clock to land at least one row keyed to our entity. We
      // don't assert on the exact count — Stage 9 has a known write-loss
      // issue (see resume note); reporting "≥1 row landed" is enough to
      // verify the Phase 1 broker swap end-to-end.
      const wrote = await waitFor(
        async () => {
          const r = await tsdb.query(
            'SELECT COUNT(*)::int AS n FROM ts_telemetry WHERE entity_id = $1',
            [entityId],
          );
          return (r.rows[0] as { n: number }).n > 0;
        },
        { timeoutMs: 60_000, pollMs: 500 },
      );

      const final = await tsdb.query(
        'SELECT COUNT(*)::int AS n FROM ts_telemetry WHERE entity_id = $1',
        [entityId],
      );
      const landed = (final.rows[0] as { n: number }).n;

      // Log BEFORE the assertion so a failure surfaces the actual count
      // ("0 landed") in CI logs rather than swallowing it on throw.
      // eslint-disable-next-line no-console
      console.log(
        `[phase5-verify] published=${MESSAGE_COUNT}, landed_in_ts_telemetry=${landed}`,
      );

      // IMPORTANT 3 — real diagnostic. graphile_worker.jobs lives in
      // digilog_db (the application DB), not digilog_tsdb. Use the prisma
      // client (already on digilog_db) for the queue snapshot, and pull
      // ConnectivityStatus to see whether the message ever reached
      // mqtt-handler at all (mqtt-handler.ts:212 upserts that row on every
      // recognised publish, BEFORE enqueueing).
      if (!wrote) {
        try {
          const queueSnapshot = await prisma.$queryRawUnsafe<
            Array<{ id: string; task_identifier: string; attempts: number; last_error: string | null }>
          >(
            `SELECT id, task_identifier, attempts, last_error
               FROM graphile_worker.jobs
              WHERE payload::text LIKE $1
              LIMIT 5`,
            `%${RUN_ID}%`,
          );
          console.error('[phase5-diag] graphile_worker.jobs at fail:', queueSnapshot);
        } catch (err) {
          console.error('[phase5-diag] graphile_worker.jobs query failed:', err);
        }
        try {
          const connRows = await prisma.connectivityStatus.findMany({
            where: { entityId },
          });
          console.error('[phase5-diag] connectivity_status rows for entity:', connRows);
        } catch (err) {
          console.error('[phase5-diag] connectivityStatus.findMany failed:', err);
        }
      }

      expect(
        wrote,
        'Expected at least one ts_telemetry row for the test entity within 60s',
      ).toBe(true);
      // Soft assertion — known Stage-9 write loss may drop some, just record.
      expect(landed).toBeGreaterThan(0);
    } finally {
      await new Promise<void>((resolve) =>
        publisher.end(false, undefined, () => resolve()),
      );
    }
  }, 120_000);

  // ─── Test 3 — graphile-worker enqueue + dispatch (Phase 2) ─────────────
  it('graphile-worker: addJob → custom task handler runs to completion', async () => {
    expect(producer, 'producer must be initialised').not.toBeNull();
    expect(runner, 'runner must be initialised').not.toBeNull();

    const probePayload = { kind: 'phase5-verify', runId: RUN_ID, ts: Date.now() };
    await producer!.addJob('phase5_verification_ping', probePayload);

    const ran = await waitFor(
      async () =>
        phase5PingPayloads.some(
          (p) => (p as { runId?: string } | null)?.runId === RUN_ID,
        ),
      { timeoutMs: 15_000, pollMs: 100 },
    );

    expect(ran, 'phase5_verification_ping handler should have been invoked within 15s').toBe(true);
  }, 30_000);

  // ─── Test 4 — PDF render — REMOVED 2026-07-04 ─────────────────────────
  // The reports generate/sign module (modules/reports/, incl. the
  // puppeteer-core/@napi-rs/canvas renderers) was deleted as dead code (no FE
  // surface since 2026-06-08). The active report-review PDF path renders
  // client-side (apps/web lib/pdf-report.ts), not through this backend renderer.
  // See tasks/REMOVE-REPORTS-MODULE-PLAN.md.
});
