/**
 * QA campaign 2026-10-19 — gated writes must go through the page's re-auth path.
 * 🔴 CLAUDE.md: "A web page that calls a gated endpoint MUST go through
 * reauth.execute/executeWithResult and render <ReauthPrompt>", otherwise an
 * enabled row is a bare 401.
 *
 *  R-01  Replacement Schedule upload (server: UPLOAD_REPLACEMENT_SCHEDULE)
 *  R-02  Pagination save (server: UPDATE_CONFIG_PAGE, now enforced on the static route)
 *  R-03  Filter Data Management unretire + manual retirement / replacement create
 *        (server: requireDataEditReauth)
 *  F-02  FDM lifecycle-step delete must hit the filter-event endpoint
 *
 * Source-level: these pages need auth, SWR and the re-auth hook to mount.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { listFiles, readSource } from '@/__tests__/support/source-files';

const read = (p: string) => readSource(resolve(__dirname, p));
const fdm = read('../filter-data-management.tsx');
const pagination = read('../pagination.tsx');
const replacement = read('../../filter-management/replacement-schedule.tsx');

/** Every .tsx under routes/ (tests excluded): listed and read once for both checks below. */
let routeFileList: string[] | undefined;
const routeFiles = () => (routeFileList ??= listFiles(resolve(__dirname, '../..'), (name) => name.endsWith('.tsx')));

describe('the signature prompt names the action being signed (F-14)', () => {
  it('no <ReauthDialog> wired to the reauth hook passes a fixed actionLabel', () => {
    const offenders: string[] = [];
    for (const f of routeFiles()) {
      const src = readSource(f);
      for (const block of src.match(/<ReauthDialog\b[\s\S]*?\/>/g) ?? []) {
        if (/open=\{reauth\.isOpen\}/.test(block) && /actionLabel="/.test(block)) offenders.push(f);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('a cancelled export password prompt is handled (C-05)', () => {
  it('every route page that calls requireExportReauth also checks isReauthCancelled', () => {
    const missing = routeFiles().filter((f) => {
      const src = readSource(f);
      return /requireExportReauth\(/.test(src) && !/isReauthCancelled\(/.test(src);
    });
    expect(missing).toEqual([]);
  });
});

describe('FDM admin-request types match the server (OQ-19 follow-up)', () => {
  it('offers exactly the request types the API accepts', () => {
    const fdmSrc = read('../filter-data-management.tsx');
    const api = readFileSync(resolve(__dirname, '../../../../../api/src/modules/admin-requests/routes.ts'), 'utf8');
    const server = JSON.parse((api.match(/requestType: \{ type: 'string', enum: (\[[^\]]+\])/)![1]).replace(/'/g, '"'));
    const consoleList = JSON.parse((fdmSrc.match(/const ADMIN_REQ_TYPES = (\[[^\]]+\])/)![1]).replace(/'/g, '"'));
    expect([...consoleList].sort()).toEqual([...server].sort());
  });
});

describe('signed writes go through the re-auth path', () => {
  it('FDM: no super-admin write is awaited directly (each one is inside gated())', () => {
    const direct = fdm.split('\n').filter((l) => /await apiClient\.(post|put|delete)\w*\(\s*[`'"]\/api\/super-admin/.test(l));
    expect(direct).toEqual([]);
  });

  it('FDM: the lifecycle-step delete names the filter-event endpoint', () => {
    const line = fdm.split('\n').find((l) => l.includes('onDeleteEvent={'));
    expect(line).toBeDefined();
    expect(line).toContain("endpoint: '/api/super-admin/data/filter-events'");
    expect(fdm).toMatch(/handleDeleteGeneric\(confirmDelete\.id, confirmDelete\.endpoint\)/);
  });

  it('Pagination: save uses reauth.execute and renders the prompt', () => {
    expect(pagination).toMatch(/reauth\.execute\('UPDATE_CONFIG_PAGE'/);
    expect(pagination).toMatch(/<ReauthPrompt reauth=\{reauth\}/);
    expect(pagination).toMatch(/apiClient\.putWithReauth\('\/api\/config\/pagination'/);
  });

  it('Replacement Schedule: upload uses reauth.execute and sends the password header', () => {
    expect(replacement).toMatch(/reauth\.execute\('UPLOAD_REPLACEMENT_SCHEDULE'/);
    expect(replacement).toMatch(/headers\['x-reauth-password'\] = password/);
  });
});
