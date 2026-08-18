import { describe, it, expect, afterEach } from 'vitest';
import { isApiDocsEnabled } from './swagger.js';

// Security assessment 2026-08-17, finding F-01 / API-07: /docs was public
// whenever NODE_ENV !== 'production'. That failed OPEN — a typo, an unset env,
// or `node dist/app.js` run by hand silently published the whole API map.
//
// The replacement must fail CLOSED: docs are served ONLY for the exact opt-in
// value, and NODE_ENV must have no say in it at all. These tests lock that
// contract, because the failure mode is silent (nothing errors, the API surface
// is just readable by anyone).

const original = { API_DOCS: process.env.API_DOCS, NODE_ENV: process.env.NODE_ENV };

afterEach(() => {
  for (const [k, v] of Object.entries(original)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('isApiDocsEnabled — fail-closed /docs gate', () => {
  it('is disabled when API_DOCS is unset', () => {
    delete process.env.API_DOCS;
    expect(isApiDocsEnabled()).toBe(false);
  });

  it.each([
    ['', 'empty'],
    ['off', 'explicit off'],
    ['false', 'false'],
    ['0', 'zero'],
    ['true', 'true is NOT the opt-in value'],
    ['1', 'one is NOT the opt-in value'],
    ['yes', 'yes is NOT the opt-in value'],
    ['onn', 'typo'],
    ['no', 'no'],
  ])('is disabled for API_DOCS=%j (%s)', (value) => {
    process.env.API_DOCS = value;
    expect(isApiDocsEnabled()).toBe(false);
  });

  it.each(['on', 'ON', 'On', ' on ', '\ton\n'])(
    'is enabled for the opt-in value %j (case/whitespace tolerant)',
    (value) => {
      process.env.API_DOCS = value;
      expect(isApiDocsEnabled()).toBe(true);
    },
  );

  // The whole point of the change: NODE_ENV must not be able to open the gate.
  it.each(['development', 'test', 'production', 'productionn', ''])(
    'ignores NODE_ENV=%j when API_DOCS is unset',
    (nodeEnv) => {
      delete process.env.API_DOCS;
      process.env.NODE_ENV = nodeEnv;
      expect(isApiDocsEnabled()).toBe(false);
    },
  );

  it('stays enabled in production if someone explicitly opts in (no hidden override)', () => {
    process.env.NODE_ENV = 'production';
    process.env.API_DOCS = 'on';
    expect(isApiDocsEnabled()).toBe(true);
  });
});
