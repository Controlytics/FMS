/**
 * Queries Module — Aggregates telemetry, alarm, export, and retention routes.
 */

import type { FastifyInstance } from 'fastify';
import telemetryRoutes from './telemetry.routes.js';
import alarmRoutes from './alarm.routes.js';
import exportRoutes from './export.routes.js';
import retentionRoutes from './retention.routes.js';

export default async function queriesModule(app: FastifyInstance) {
  await app.register(telemetryRoutes);
  await app.register(alarmRoutes, { prefix: '/alarms' });
  await app.register(exportRoutes, { prefix: '/export' });
  await app.register(retentionRoutes);
}
