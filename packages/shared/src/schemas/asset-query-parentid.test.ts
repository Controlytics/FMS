/**
 * M11 residual (QA 2026-10-19): `parentId=null` is the root-node sentinel the
 * instance list handles (`instance.service list()`); the uuid-only schema
 * rejected it, so root filtering was unreachable.
 */
import { describe, it, expect } from 'vitest';
import { assetQuerySchema } from './assets.js';

describe('assetQuerySchema parentId (M11 residual)', () => {
  it('accepts the literal "null" root sentinel', () => {
    expect(assetQuerySchema.parse({ parentId: 'null' }).parentId).toBe('null');
  });
  it('still accepts a uuid and still refuses anything else', () => {
    expect(assetQuerySchema.parse({ parentId: '6adf7404-2b18-4c78-9f33-0a5841221db6' }).parentId).toBeDefined();
    expect(() => assetQuerySchema.parse({ parentId: 'not-a-uuid' })).toThrow();
  });
});
