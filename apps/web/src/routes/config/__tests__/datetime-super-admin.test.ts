import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * Date/Time Format is SUPER_ADMIN-only (2026-09-03, operator request).
 *
 * Source-text assertions, in the same style as `src/__tests__/route-guard-
 * coverage.test.ts`: the three frontend facts that must agree with the
 * `requireSuperAdmin()` preHandlers on GET/PUT /api/config/datetime. Rendering
 * these pages in jsdom would need the whole SWR + auth + router stack and would
 * still not assert the thing that matters — which list the card is declared in.
 *
 * The BACKEND gate is locked separately, and properly, by
 * `apps/api/src/e2e/config.test.ts` ("403s for a real ADMIN despite CONFIG_READ").
 */
const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');

const mainTsx = read('../../../main.tsx');
const configIndex = read('../index.tsx');
const accessMatrix = read('../access-matrix.tsx');

describe('Date/Time config is SUPER_ADMIN-only', () => {
  it('guards the /config/datetime route on the role, not CONFIG_READ', () => {
    const route = mainTsx
      .split('\n')
      .find((l) => l.includes('path="/config/datetime"'));
    expect(route, '/config/datetime route not found in main.tsx').toBeTruthy();
    expect(route).toContain("roles={['SUPER_ADMIN']}");
    expect(route).not.toContain('CONFIG_READ');
  });

  it('declares the card in superAdminCards, not configCards', () => {
    // The two lists gate differently: configCards is filtered by the access
    // matrix (a grant an ADMIN can hold), superAdminCards by EXPLICIT_GRANT_KEYS
    // (empty). A card left in configCards would still be reachable for anyone
    // granted `datetime` — and would then meet a 403 on every call.
    const superAdminAt = configIndex.indexOf('const superAdminCards = [');
    const cardAt = configIndex.indexOf("href: '/config/datetime'");
    expect(superAdminAt).toBeGreaterThan(-1);
    expect(cardAt).toBeGreaterThan(-1);
    expect(cardAt).toBeGreaterThan(superAdminAt);
    // Exactly one declaration — not left behind in configCards as well.
    expect(configIndex.split("href: '/config/datetime'").length - 1).toBe(1);
  });

  it('stops offering `datetime` as a grantable module in the access matrix', () => {
    // Granting it can no longer do anything; offering the toggle would lie.
    const hidden = accessMatrix.slice(
      accessMatrix.indexOf('const HIDDEN_MODULE_KEYS'),
      accessMatrix.indexOf('const EXTRA_MODULES'),
    );
    expect(hidden).toContain("'datetime'");
  });
});
