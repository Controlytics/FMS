/**
 * Export the FRESH-INSTALL baseline from a configured database.
 *
 *   cd apps/api && npx tsx prisma/export-install-baseline.ts
 *   (reads DATABASE_URL from apps/api/.env -> the dev digilog_db)
 *
 * Writes prisma/install-baseline.json: the roles, role configs (sidebar +
 * feature toggles) and system settings a NEW customer install starts with.
 * seed.ts applies it create-only, and only when SEED_INSTALL_BASELINE=1
 * (provision-db.ps1 -> apply-schema.ps1 -UseInstallBaseline, i.e. fresh
 * install). Upgrades never read it.
 *
 * Why it exists: without it a fresh install got the code defaults - MAINTENANCE
 * and VIEWER roles but no MANAGER / QA / SHIFTOFFICER, ADMIN with 74 permissions,
 * re-auth (e-signature) off everywhere and every role allowed on the tablet -
 * which is not the configuration the OQ scripts were written against.
 *
 * What is NOT copied, on purpose:
 *  - any operational record (filters, cycles, PM, audit, users other than the
 *    superadmin the seed creates) - none of it is read here at all;
 *  - system_config keys outside SETTINGS_ALLOWLIST. A new key is left out until
 *    someone decides it belongs in a new install. The allowlist is the guard
 *    against shipping credentials (SMTP / SMS / LDAP) or this PC's paths;
 *  - references to master data that is not shipped (cleaning-profile-assignment
 *    points at profile + AHU ids that will not exist on the new server).
 *
 * Re-run it whenever the approved role matrix or settings change, and review
 * the diff of install-baseline.json before committing.
 */
import { PrismaClient } from '@prisma/client';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PERMISSIONS, REAUTH_ACTIONS, SIDEBAR_ITEMS, FEATURE_PRIVILEGES } from '@digilog/shared';
import { defaultRoles } from './default-roles.js';

/** Settings copied into a new install. Everything else stays at the app default. */
const SETTINGS_ALLOWLIST = [
  // Access + e-signature (what the OQ scripts verify)
  'access-matrix', 'action-reauth', 'tablet-access', 'dashboard-cards', 'export-options',
  'super-admin-api-access',
  // Security
  'password-policy', 'login-security', 'session', 'user-id',
  // Workflows
  'filter-approval', 'pm-schedule-approval', 'replacement-schedule-approval', 'stage-interlock',
  'block-change-approval', 'pm-schedule-settings', 'qnn-notifications', 'guest-cleaning-requests',
  'ahu-completion-process',
  // Display / reports
  'branding', 'datetime', 'pagination', 'export-limit', 'backup-format', 'offline-cache',
  'report-page-titles', 'report-settings', 'report-signatories',
  // Dropdown lists
  'filter-cleaning-reasons', 'filter-field-options',
] as const;

/**
 * Values on the source PC that are test leftovers, not configuration. Removed
 * from the baseline only - the source database is never written.
 */
const TEST_RESIDUE = {
  cleaningReasonKeys: ['TEST', 'XXXX'],
  fieldOptions: { ahuType: ['Test'], filterType: ['xdghg'] } as Record<string, string[]>,
  // A test run left a timestamp in this label; the report default is "By:".
  performedByLabel: { bad: /\(\d{6,}\)/, replacement: 'By:' },
};

/** A value that looks like a credential or a host must never be shipped. */
const SECRET_KEY = /pass(word)?|secret|token|api[-_]?key|smtp|host|ldap|bind/i;

function assertNoSecrets(path: string, value: unknown): void {
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      // A credential is a non-empty STRING. Keys that are page names (access-matrix
      // 'password-policy': ['ADMIN']) or policy rules (minLength: 8) are not.
      if (SECRET_KEY.test(k) && typeof v === 'string' && v !== '') {
        throw new Error(`Refusing to export ${path}.${k}: looks like a credential or host.`);
      }
      assertNoSecrets(`${path}.${k}`, v);
    }
  }
}

function scrub(key: string, value: any): any {
  if (key === 'filter-cleaning-reasons' && Array.isArray(value?.value)) {
    return { ...value, value: value.value.filter((r: any) => !TEST_RESIDUE.cleaningReasonKeys.includes(r.key)) };
  }
  if (key === 'filter-field-options' && value?.value && typeof value.value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [field, list] of Object.entries(value.value as Record<string, unknown>)) {
      const drop = TEST_RESIDUE.fieldOptions[field] ?? [];
      out[field] = Array.isArray(list) ? list.filter((x) => !drop.includes(String(x))) : list;
    }
    return { ...value, value: out };
  }
  if (key === 'report-page-titles' && typeof value?.performedByLabel === 'string'
      && TEST_RESIDUE.performedByLabel.bad.test(value.performedByLabel)) {
    return { ...value, performedByLabel: TEST_RESIDUE.performedByLabel.replacement };
  }
  if (key === 'action-reauth' && value && typeof value === 'object') {
    // Drop actions that no longer exist (e.g. SIGN_REPORT, removed 2026-07-04).
    return Object.fromEntries(Object.entries(value).filter(([a]) => a in REAUTH_ACTIONS));
  }
  return value;
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const validPerms = new Set<string>(Object.values(PERMISSIONS));
    const validSidebar = new Set(SIDEBAR_ITEMS.map((s) => s.id));
    const validPrivileges = new Set(FEATURE_PRIVILEGES.map((p) => p.id));
    const dropped: string[] = [];

    const roles = (await prisma.role.findMany({ where: { isActive: true }, orderBy: { hierarchyLevel: 'desc' } }))
      .map((r) => {
        let perms = (r.permissions as string[]).filter((p) => {
          if (validPerms.has(p)) return true;
          dropped.push(`role ${r.name}: permission ${p}`);
          return false;
        });
        if (r.name === 'SUPER_ADMIN') {
          // SUPER_ADMIN bypasses every check; keep the shipped list as a floor.
          const shipped = defaultRoles.find((d) => d.name === 'SUPER_ADMIN')?.permissions ?? [];
          perms = [...new Set([...perms, ...shipped])];
        }
        return {
          name: r.name, displayName: r.displayName, description: r.description,
          hierarchyLevel: r.hierarchyLevel, permissions: perms.sort(), color: r.color,
          isSystem: r.isSystem,
        };
      });
    const roleNames = new Set(roles.map((r) => r.name));

    const roleConfigs = (await prisma.roleConfig.findMany({ orderBy: { role: 'asc' } }))
      .filter((rc) => roleNames.has(rc.role))
      .map((rc) => ({
        role: rc.role,
        sidebarItems: (rc.sidebarItems as string[]).filter((s) => {
          if (validSidebar.has(s)) return true;
          dropped.push(`role config ${rc.role}: sidebar ${s}`);
          return false;
        }),
        homeWidgets: rc.homeWidgets,
        permissions: Object.fromEntries(Object.entries(rc.permissions as Record<string, boolean>)
          .filter(([id]) => {
            if (validPrivileges.has(id)) return true;
            dropped.push(`role config ${rc.role}: privilege ${id}`);
            return false;
          })),
      }));

    const rows = await prisma.systemConfig.findMany({ where: { configKey: { in: [...SETTINGS_ALLOWLIST] } } });
    const settings = rows
      .filter((row) => {
        const v = row.configValue as unknown;
        const empty = v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0;
        if (empty) dropped.push(`setting ${row.configKey}: empty on the source, app default applies`);
        return !empty;
      })
      .map((row) => {
        const value = scrub(row.configKey, row.configValue);
        assertNoSecrets(row.configKey, value);
        return { configKey: row.configKey, configValue: value, configType: row.configType, requiresReauth: row.requiresReauth };
      })
      .sort((a, b) => a.configKey.localeCompare(b.configKey));

    for (const required of ['tablet-access', 'action-reauth', 'access-matrix']) {
      if (!settings.some((s) => s.configKey === required)) throw new Error(`Source DB has no '${required}' setting; refusing to export a baseline without it.`);
    }

    const baseline = {
      $comment: 'Fresh-install starting setup. Generated by prisma/export-install-baseline.ts - do not hand-edit; re-export and review the diff.',
      generatedAt: new Date().toISOString(),
      roles, roleConfigs, settings,
    };
    const out = join(process.cwd(), 'prisma', 'install-baseline.json');
    // branding.version is whatever the source DB holds; the installer build
    // replaces it in its staged copy with -AppVersion (scripts/stamp-install-version.mjs).
    // Keep this formatting: that script writes the same JSON.stringify(x, null, 2).
    writeFileSync(out, JSON.stringify(baseline, null, 2) + '\n', 'utf8');

    console.log(`Wrote ${out}`);
    console.log(`  roles: ${roles.map((r) => `${r.name}(${r.permissions.length})`).join(', ')}`);
    console.log(`  role configs: ${roleConfigs.length}, settings: ${settings.length}`);
    console.log(`  left out (${dropped.length}):`);
    for (const d of dropped) console.log(`    - ${d}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
