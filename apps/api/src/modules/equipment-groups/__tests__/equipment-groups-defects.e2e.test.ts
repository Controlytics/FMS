/**
 * Regression tests for D5 (an equipment group may only belong to a live Block)
 * and D1 (a redirect from an instrument endpoint is reported as such, from the
 * HTTP status, and its target is never fetched). Real harness app + Prisma; the
 * instrument endpoint is a real HTTP server on this PC's LAN address (loopback
 * is refused by the SSRF guard), skipped when the machine has no LAN IPv4.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import os from 'node:os';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../../../lib/prisma.js';
import { buildSliceApp, SliceOwner, runTag, instruments, type Caller } from '../../assets/__tests__/slice-support.js';

const own = new SliceOwner(runTag('CVDE'));
let app: FastifyInstance;
let sa: { call: Caller };
let blockId: string;
let deadBlockId: string;
let ahuId: string;
let otherId: string;

const lanIp = Object.values(os.networkInterfaces()).flat().find((a) => a && a.family === 'IPv4' && !a.internal)?.address;
let server: http.Server | undefined;
let base = '';
const hits: string[] = [];

beforeAll(async () => {
  app = await buildSliceApp();
  sa = await own.user(app, 'sa', 'SUPER_ADMIN');
  const blockTpl = await own.template('BLOCK');
  blockId = await own.instance('BLOCK', blockTpl);
  deadBlockId = await own.instance('BLOCK-DEAD', blockTpl, null, { isActive: false });
  ahuId = await own.instance('AHU', await own.template('AHU'), blockId);
  otherId = await own.instance('OTHER', await own.template('OTHER'));
  if (lanIp) {
    server = http.createServer((req, res) => {
      hits.push(req.url ?? '');
      if (req.url?.startsWith('/redirect')) {
        const status = Number(req.url.split('/')[2]);
        res.writeHead(status, { location: '/target' });
        return res.end();
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ reading: { air: 6.2 } }));
    });
    await new Promise<void>((r) => server!.listen(0, lanIp, () => { base = `http://${lanIp}:${(server!.address() as AddressInfo).port}`; r(); }));
  }
}, 60_000);

afterAll(async () => {
  server?.closeAllConnections();
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  await own.cleanup();
  await app?.close();
}, 60_000);

describe('D5 — an equipment group belongs to a live Block', () => {
  it('refuses an AHU, another kind of entity and a deactivated block with 404 Block not found, and writes nothing', async () => {
    for (const id of [ahuId, otherId, deadBlockId]) {
      const res = await sa.call('POST', '/api/equipment-groups', { body: { name: own.n(`EG-${id.slice(0, 4)}`), blockId: id, instruments: instruments() } });
      expect(res.status, id).toBe(404);
      expect(res.body).toEqual({ error: 'NOT_FOUND', message: 'Block not found' });
    }
    expect(await prisma.equipmentGroup.count({ where: { blockId: { in: [ahuId, otherId, deadBlockId] } } })).toBe(0);
  });

  it('a live block is still accepted', async () => {
    const res = await sa.call('POST', '/api/equipment-groups', { body: { name: own.n('EG-OK'), blockId, instruments: instruments() } });
    expect(res.status).toBe(201);
    expect(res.body.blockId).toBe(blockId);
  });
});

describe.skipIf(!lanIp)('D1 — an instrument endpoint that redirects', () => {
  it('is reported as "Redirects are not allowed" for every redirect status, and the target is never fetched', async () => {
    for (const status of [301, 302, 303, 307, 308]) {
      hits.length = 0;
      const res = await sa.call('POST', '/api/equipment-groups/test-url', { body: { url: `${base}/redirect/${status}` } });
      expect(res.status, String(status)).toBe(200);
      expect(res.body, String(status)).toEqual({ ok: false, error: 'Redirects are not allowed' });
      expect(hits, String(status)).toEqual([`/redirect/${status}`]);
    }
  });

  it('a normal reading still comes back', async () => {
    const res = await sa.call('POST', '/api/equipment-groups/test-url', { body: { url: `${base}/ok` } });
    expect(res.body).toMatchObject({ ok: true, reading: { air: 6.2 } });
  });
});
