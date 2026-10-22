/**
 * D03-15 (team decision 2026-10-22): Tablet App Access, LDAP and the dynamic
 * config pages (AHU completion process, backup format, export limit) are
 * SUPER_ADMIN-only. The config index had always shown them only to SUPER_ADMIN
 * (they are `superAdminCards`; EXPLICIT_GRANT_KEYS is empty), but the routes
 * took CONFIG_READ, so ADMIN reached them by URL. The API side is locked by
 * apps/api/src/e2e/config-sa-only-pages.test.ts.
 *
 * Source assertions in the style of datetime-super-admin.test.ts (main.tsx
 * mounts the whole app on import), plus a render of the same guard props.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { screen } from '@testing-library/react';
import { mockApi, renderPage } from '@/test-utils/page-harness';
import { RequireRole } from '@/components/require-role';
import { TabletAccessConfigPage } from '../tablet-access';
import { commonRoutes, resetEnv } from './config-test-helpers';

afterEach(resetEnv);

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');
const mainTsx = read('../../../main.tsx');
const configIndex = read('../index.tsx');
const accessMatrix = read('../access-matrix.tsx');

const routeLine = (path: string) => mainTsx.split('\n').find((l) => l.includes(`path="${path}"`));

describe('the three pages are guarded on the role, not CONFIG_READ', () => {
  for (const path of ['/config/tablet-access', '/config/ldap', '/config/dynamic/:moduleKey']) {
    it(path, () => {
      const line = routeLine(path);
      expect(line, `${path} route not found in main.tsx`).toBeTruthy();
      expect(line).toContain("roles={['SUPER_ADMIN']}");
      expect(line).not.toContain('CONFIG_READ');
      expect(line).not.toContain('CONFIG_UPDATE');
    });
  }

  it('their cards are Super Admin Settings cards (never shown to a granted role)', () => {
    const superAdminAt = configIndex.indexOf('const superAdminCards = [');
    for (const href of ["'/config/tablet-access'", "'/config/ldap'", "'/config/dynamic/ahu-completion-process'"]) {
      const at = configIndex.indexOf(`href: ${href}`);
      expect(at, href).toBeGreaterThan(superAdminAt);
      expect(configIndex.split(`href: ${href}`).length - 1, href).toBe(1);
    }
  });
});

describe('every page behind /config/dynamic/:moduleKey is SUPER_ADMIN-only on the API', () => {
  // The route guard above is generic. It is right only while every def that
  // renders on the dynamic page (hasCustomPage: false) is requiredRole
  // SUPER_ADMIN — which the API enforces on its GET/PUT. A delegable dynamic
  // def must revisit the route guard; this fails until it does.
  it('no dynamic def is delegable', () => {
    const defsDir = resolve(__dirname, '../../../../../api/src/modules/config/defs');
    const delegable = readdirSync(defsDir)
      .filter((f) => f.endsWith('.def.ts'))
      .map((f) => ({ f, src: readFileSync(join(defsDir, f), 'utf8') }))
      .filter(({ src }) => /hasCustomPage:\s*false/.test(src) && !/requiredRole:\s*'SUPER_ADMIN'/.test(src))
      .map(({ f }) => f);
    expect(delegable).toEqual([]);
  });

  it('the access matrix stops offering grants that the API refuses', () => {
    const hidden = accessMatrix.slice(
      accessMatrix.indexOf('const HIDDEN_MODULE_KEYS'),
      accessMatrix.indexOf('const EXTRA_MODULES'),
    );
    for (const key of ['ahu-completion-process', 'backup-format', 'export-limit']) expect(hidden, key).toContain(`'${key}'`);
  });
});

describe('the guard as rendered', () => {
  it('ADMIN (CONFIG_READ + CONFIG_UPDATE) gets Access Denied and the page asks the API for nothing', async () => {
    const api = mockApi([...commonRoutes()]);
    renderPage(
      <RequireRole roles={['SUPER_ADMIN']}><TabletAccessConfigPage /></RequireRole>,
      { user: { role: 'ADMIN', permissions: ['CONFIG_READ', 'CONFIG_UPDATE'] }, api },
    );
    expect(await screen.findByRole('heading', { name: 'Access Denied' })).toBeInTheDocument();
    expect(api.calls('GET', '/api/config/tablet-access')).toHaveLength(0);
  });

  it('SUPER_ADMIN gets the page', async () => {
    const api = mockApi([
      { path: '/api/config/tablet-access', body: {} },
      { path: '/api/roles/active', body: [{ name: 'OPERATOR', displayName: 'Operator' }] },
      ...commonRoutes(),
    ]);
    renderPage(
      <RequireRole roles={['SUPER_ADMIN']}><TabletAccessConfigPage /></RequireRole>,
      { user: { role: 'SUPER_ADMIN', permissions: [] }, api },
    );
    expect(await screen.findByRole('button', { name: 'Login for Operator' })).toBeInTheDocument();
  });
});
