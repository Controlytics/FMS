import type { FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

/**
 * Is the Swagger UI (/docs) allowed to be served?
 *
 * FAIL CLOSED, and deliberately NOT keyed off NODE_ENV (security assessment
 * 2026-08-17, finding F-01 / API-07). The previous rule — "public unless
 * NODE_ENV === 'production'" — failed OPEN: a typo, an unset env, or anyone
 * running `node dist/app.js` by hand silently published the entire API map
 * with no warning. Exposure must be an explicit, deliberate act instead.
 *
 * Set API_DOCS=on to serve /docs. Anything else (unset, empty, 'off', a typo)
 * means @fastify/swagger-ui is never registered at all — no route, no spec, no
 * asset listing. Verified: a request to /docs then returns exactly the same
 * `401 {"error":"UNAUTHORIZED","message":"Missing token"}` as any nonexistent
 * path (the auth onRequest hook fires before routing), so it does not even
 * leak that /docs is a thing this server knows about.
 *
 * Single source of truth: plugins/auth.ts imports this so the JWT allowlist
 * and the route registration can never disagree.
 */
export function isApiDocsEnabled(): boolean {
  return (process.env.API_DOCS ?? '').trim().toLowerCase() === 'on';
}

export async function registerSwagger(app: FastifyInstance) {
  await app.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'DigiLog API',
        description: `# 21 CFR Part 11 Compliant Digital Logbook — REST API

## Authentication
1. Use **POST /api/auth/login** to obtain a JWT token
2. Click **Authorize** (lock icon) and enter: \`Bearer <your-token>\`
3. All subsequent requests will include the token

## Default Credentials
- Contact your system administrator for initial credentials
- First login will require password change

## Re-authentication (electronic signature)
Sensitive writes may answer **401 REAUTH_REQUIRED**. Repeat the call with the
caller's password in the body as \`_currentPassword\` (it is stripped before the
handler runs). Which actions require it is configured on Config → Action Re-auth.
Every re-authentication is itself an audit row (\`REAUTH_SUCCESS\` / \`REAUTH_FAILED\`).

## Roles
Roles and their privileges are configurable (Config → Roles & Access); the table is
the shipped set. Every role's actions are written to the hash-chained audit trail —
SUPER_ADMIN rows are hidden from non-SUPER_ADMIN readers, not skipped.

| Role | Level | Shipped scope |
|------|-------|---------------|
| SUPER_ADMIN | 6 | System owner, full access, bypasses permission checks |
| ADMIN | 5 | User, role and configuration management |
| SUPERVISOR | 4 | PM / replacement schedule upload, approvals |
| QA | 3 | Approvals (filter creation, PM entries, stage interlocks, report reviews) |
| MANAGER | 1 | Filter creation review, retirement |
| OPERATOR | 1 | Cleaning operations on the tablet, RFID, replacement |
| SHIFTOFFICER | 1 | Shift-level operations and approvals as configured |

## Serving these docs
\`/docs\` exists only when \`API_DOCS=on\` is set for the API process. Without it the
path answers like any unknown route. Never enable on a customer machine.`,
        version: '1.0.0',
        contact: {
          name: 'DigiLog Support',
        },
      },
      // Relative URL: "Try it out" calls the SAME origin that served /docs.
      // Works for localhost (host) and LAN IP (remote laptop) without hardcoding
      // scheme/host — and avoids the mixed-content block when API_HTTPS=true.
      servers: [
        {
          url: '/',
          description: 'This server (same origin as the docs page)',
        },
      ],
      // Every tag a route carries is defined here, in the order the docs page
      // should list them. 2026-10-05: 26 tags used by routes had no entry (the
      // whole filter-management surface — PM Schedules, Filter Operations,
      // Replacement Schedule, Hierarchy, … — rendered unordered and undescribed),
      // and two modules were split across duplicate tags ('Configuration' vs
      // 'Config', 'Authentication' vs 'Auth'); the routes now use one tag each.
      // 2026-07-03: removed 10 dead tags for subsystems torn out in Phase 6/7.
      tags: [
        // ── Platform ──
        { name: 'Health', description: 'Health check — DB connectivity and the in-process job runner' },
        { name: 'Deployment', description: 'Deployment verification checks (DB, config, certificates)' },
        { name: 'Auth', description: 'Authentication — login, logout, token refresh, password change/reset, re-authentication, offline-replay grant' },
        { name: 'Guest', description: 'Public guest endpoints — filter cleaning request (no login)' },
        { name: 'Users', description: 'User management — CRUD, stats, enable/disable, unlock, password reset requests' },
        { name: 'User Groups', description: 'User groups — named sets of users for notification targeting' },
        { name: 'Roles', description: 'Role management — CRUD, permissions, hierarchy, sidebar/feature access matrix' },
        { name: 'Admin Requests', description: 'Contact-admin requests — role change / unlock requests submitted from the login page and processed by an admin' },
        { name: 'Config', description: 'System configuration — static tabs (password policy, login security, session, datetime, branding, user ID, field IDs, action re-auth, audit templates, pagination, report config) and the auto-discovered dynamic definitions under /api/config/dynamic/*' },
        { name: 'LDAP', description: 'LDAP / Active Directory — configuration, connection test, status' },
        { name: 'Audit', description: 'Audit trail — hash-chained, immutable rows; filtering, detail, redaction, chain verification, report-export log, and the permanent-delete endpoints (which break the chain)' },
        { name: 'Debug Traces', description: 'Debug traces — audited-action pipeline traces for troubleshooting (reads audit_trail)' },
        { name: 'System Health', description: 'System health — request tracking, throughput stats, and system metrics' },
        { name: 'Backup', description: 'Database backup & restore — export (JSON, BAK, pg_dump), validate, and restore with SHA-256 checksum integrity' },
        { name: 'Uploads', description: 'File uploads — profile photos (JPEG, PNG, GIF, WebP, max 5MB)' },
        { name: 'Help', description: 'Help articles — versioned documentation with CRUD and version history' },
        { name: 'Dashboards', description: 'Dashboards — user dashboards and widgets' },
        // ── Notifications ──
        { name: 'Notifications', description: 'Notifications — role-based user alerts and badges' },
        { name: 'Notification Settings', description: 'Notification delivery settings — email (SMTP/OAuth2), SMS (AWS SNS/Twilio/Vonage), templates, delivery logs' },
        { name: 'Notification Rules', description: 'Notification rules — event-based routing with multi-channel delivery (email, SMS, in-app), recipient targeting, cooldown' },
        // ── Hierarchy & filters (master data) ──
        { name: 'Hierarchy', description: 'Typed hierarchy — blocks, areas, AHUs and filters (typed create/list/get; filter creation enters the review → approve workflow)' },
        { name: 'Entity Templates', description: 'Entity templates — the BLOCK / AREA / AHU / FILTER blueprints (attribute schema, template kind)' },
        { name: 'Entities', description: 'Entity instances — the generic asset layer under the typed hierarchy: create, update, deactivate, parent/child relationships, filter review/approve/retire/replace' },
        { name: 'Entity Identifiers', description: 'RFID tags — assign (one per filter; `replaceExisting` swaps the held tag), unassign, lookup by value, and the RFID Track Record report' },
        { name: 'Filter Profiles', description: 'Filter profiles — filter → cleaning-profile assignment with archived versions' },
        { name: 'Cleaning Profiles', description: 'Cleaning profiles — the stage/checklist pipeline graph a cycle follows; versioned per lineage' },
        { name: 'Checklist Profiles', description: 'Checklist profiles — question sets referenced by pipeline CHECKLIST nodes; snapshot-versioned on every edit' },
        { name: 'Checklist Questions', description: 'Checklist questions — add, edit, delete and reorder the questions of a checklist profile' },
        { name: 'Equipment Groups', description: 'Equipment groups — a block\'s cleaning station and its three instruments (operating ranges drive reading validation); composite-versioned' },
        // ── Cleaning operations ──
        { name: 'Filter Operations', description: 'Cleaning cycle operations — current-state action tape, start, advance, advance-with-checklist, submit-checklist, bypass, terminate, retire, bulk-operate; dryer SET_DURATION / SUBMIT_READINGS ride on /advance' },
        { name: 'Cleaning Cycles', description: 'Cleaning cycle reads — cycle list/detail, unified cleaning record, manual status changes, dashboard stats' },
        { name: 'Filter Events', description: 'Filter events — the immutable per-transition event log (SHA-256 checksummed)' },
        { name: 'Stage Approvals', description: 'Stage interlock approvals — pending stage transitions awaiting an approver, single and bulk approve/reject' },
        { name: 'Sync', description: 'Offline sync — tablet master-data snapshot for the IndexedDB cache' },
        // ── Preventive maintenance & replacement ──
        { name: 'PM Schedules', description: 'Preventive maintenance — yearly schedules with irregular visits per AHU, CSV/XLSX upload (append, overlap-guarded), review/approve workflow, due tasks, missed-PM write-offs, QNN report' },
        { name: 'PM Executions', description: 'PM executions — recording that a scheduled PM visit was performed' },
        { name: 'Replacement Schedule', description: 'Filter replacement schedule — XLSX upload (validated against each AHU\'s live filters), review/approve workflow, execution' },
        { name: 'Block Change Requests', description: 'Block change requests — move a filter between blocks with approval' },
        { name: 'Report Reviews', description: 'Report reviews — ad-hoc report submit → review → approve with electronic signatures' },
        // ── Super admin ──
        { name: 'Super Admin', description: 'SUPER_ADMIN-only tools — tablet access, API-access toggle, record edits that are themselves audit rows' },
        { name: 'Super Admin - Data Management', description: 'Filter Data Management console — SUPER_ADMIN-only create/edit/delete across cycles, events, PM, replacements, retirements and audit rows; every write needs `_changeReason` and is audited' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'JWT token obtained from POST /api/auth/login. Format: Bearer <token>',
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
  });

  // ─── Swagger UI (/docs) — opt-in only ──────────────────────────────────────
  // See isApiDocsEnabled() above. When disabled we do not register the plugin,
  // so /docs and every /docs/* asset simply do not exist as routes.
  //
  // The old uiHooks Bearer-token check was removed with this change: it could
  // never be satisfied by a browser (a navigation to /docs sends no
  // Authorization header), so it protected nothing that the auth plugin did not
  // already reject, while reading as if /docs were usable-when-authenticated.
  if (!isApiDocsEnabled()) {
    app.log.info('API docs disabled (set API_DOCS=on to serve /docs)');
    return;
  }

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
      persistAuthorization: true,
      displayRequestDuration: true,
      filter: true,
      tryItOutEnabled: true,
      syntaxHighlight: { theme: 'monokai' },
    },
    staticCSP: false,
  });

  app.log.warn(
    'API docs ENABLED at /docs — the full API surface is readable without a ' +
    'login. Intended for development only; unset API_DOCS on any shared or ' +
    'customer machine.',
  );
}
