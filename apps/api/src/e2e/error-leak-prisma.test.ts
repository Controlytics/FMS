import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, loginAs } from './test-helper.js';

// VAPT-5 (2026-08-18): an input that passed the schema's max-length check
// overflowed a DB column AFTER server-side sanitization *escaped* the HTML
// (`<script>` -> `&lt;script&gt;`, +12 chars). Prisma raised P2000 and the
// catch-all echoed err.message when NODE_ENV=development — leaking the absolute
// source path + a code snippet (CWE-209). The global handler now maps P2000 to a
// clean 400 VALUE_TOO_LONG and never surfaces raw Prisma text.

let app: FastifyInstance;
let token: string;
beforeAll(async () => { app = await buildApp(); token = await loginAs(app); });
afterAll(async () => { await app.close(); });

describe('VAPT-5 — Prisma errors do not leak internals', () => {
  it('maps a post-sanitization column overflow to 400 VALUE_TOO_LONG, no source path', async () => {
    // department column is VARCHAR(50); this is 39 chars raw (passes Zod max(50))
    // but escapes to 51 chars, overflowing the column.
    const res = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        username: 'VAPTP5',
        fullName: 'Bob',
        role: 'VIEWER',
        password: 'Pentest@12345',
        confirmPassword: 'Pentest@12345',
        department: '<script>alert(document.cookie)</script>',
      },
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('VALUE_TOO_LONG');
    // The response must not carry Prisma internals / source paths / snippets.
    expect(res.body).not.toMatch(/prisma\./i);
    expect(res.body).not.toMatch(/\.ts:\d+/);
    expect(res.body).not.toMatch(/user\.repository/);
  });
});
