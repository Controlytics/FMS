export { prisma } from './prisma.js';
export { getTsdbPool, closeTsdbPool, healthCheck } from './tsdb.js';
export {
  initTelemetryBatcher,
  addTelemetryRow,
  addDeviceEventRow,
  flushTelemetry,
  flushDeviceEvents,
  flushAll,
  closeTelemetryBatcher,
  getTelemetryBufferSize,
  getDeviceEventBufferSize,
  // Audit 2026-05-04 fix (queue review H4): drop counters for system-health
  // surface — operators can see lifetime overflow + requeue drop counts.
  getTelemetryBatcherStats,
} from './telemetry-batcher.js';
