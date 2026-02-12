import { createHash } from 'node:crypto';

export function computeChecksum(data: Record<string, unknown>): string {
  const payload = JSON.stringify(data, Object.keys(data).sort());
  return createHash('sha256').update(payload).digest('hex');
}
