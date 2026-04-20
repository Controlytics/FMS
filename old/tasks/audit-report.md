# DigiLog Production Audit Report

**Date:** 2026-04-09
**Auditor:** Claude Code (Automated)
**Application:** DigiLog — Digital Filter Management System
**Stack:** Fastify + Prisma + PostgreSQL + React + Vite
**Deployment:** AWS EC2 (Nginx + PM2)
**Compliance Target:** 21 CFR Part 11

---

## Final Audit Score

| Area             | Score | Verdict |
|------------------|-------|---------|
| Security         | 5/10  | Multiple critical flaws — hardcoded creds, timing attacks, table injection |
| Performance      | 6/10  | N+1 queries on hot paths, missing indexes |
| Reliability      | 6/10  | Partial transaction failures, org scoping leaks |
| Maintainability  | 7/10  | Good structure, raw SQL pattern risky |

---

## CRITICAL FAILURES (P0 — Must Fix Before Production)

### C1. Hardcoded `Admin@123` Default + Advertised in Swagger

**Files:**
- `apps/api/prisma/seed.ts:165`
- `apps/api/src/lib/swagger.ts:23`

**Code:**
```ts
// seed.ts
const defaultPassword = process.env.INITIAL_ADMIN_PASSWORD ?? 'Admin@123';

// swagger.ts — description advertises the credential
// - **Username:** `admin`
// - **Password:** `Admin@123`
```

**Risk:** If `INITIAL_ADMIN_PASSWORD` env var is missing in production, the seed silently falls back to a known default that is publicly documented in Swagger at `/docs`. An attacker reads the API docs and logs in as SUPER_ADMIN.

**Fix:**
- Remove the `?? 'Admin@123'` fallback — throw if env var is unset
- Strip credentials from Swagger description
- Disable `/docs` route in production

**Status:** FIXED

---

### C2. MQTT Auth — Timing Attack + Empty Password Bypass

**File:** `apps/api/src/transport/mqtt-auth-routes.ts:64-66`

**Code:**
```ts
const expectedPassword = process.env.EMQX_ADMIN_PASSWORD ?? '';
if (password === expectedPassword) {
```

**Risk:**
1. Direct `===` comparison is vulnerable to timing side-channel attack — attacker can reconstruct the password byte-by-byte
2. If `EMQX_ADMIN_PASSWORD` is unset, fallback is `''` — sending `password: ""` grants full MQTT publish rights

**Fix:** Use `crypto.timingSafeEqual()` with Buffer comparison. Reject if env var is empty/unset.

**Status:** FIXED

---

### C3. Rule Chain Action Node — INSERT Into Any DB Table

**File:** `apps/api/src/modules/rule-chain/nodes/action-nodes.ts:314`

**Code:**
```ts
await prisma.$executeRawUnsafe(
  `INSERT INTO "${tableName}" (${columnList}) VALUES (${placeholders})`, ...values
);
```

**Risk:** Any ADMIN user can configure a rule chain node with `tableName: "users"` or `"audit_trail"` and INSERT arbitrary rows into sensitive tables, bypassing Prisma access controls. The regex validates format but not destination.

**Fix:** Whitelist allowed table names — only `ts_*` telemetry tables permitted.

**Status:** FIXED

---

## HIGH RISK ISSUES (P1)

### H1. N+1 Queries on Every Filter Operation

**File:** `apps/api/src/modules/filter-operations/filter-operations.service.ts`

**Locations:**
- `resolveChecklistQuestions` (line 52) — 1 query per checklist node
- `advance()` checklist enforcement (line 536) — 1 query per node in loop
- `resolveFilterProfile` BY_BLOCK mode (line 143) — 1 query per ancestor level

**Impact:** Each filter advance/getCurrentState fires 3-8 sequential DB queries. With 50 concurrent operators this becomes a DB bottleneck.

**Fix:** Batch `findMany` with `{ id: { in: ids } }` instead of per-item loops.

**Status:** FIXED

---

### H2. `retire()` — Partial Transaction Failure

**File:** `filter-operations.service.ts` — cycle `updateMany` happens OUTSIDE the main `$transaction`

**Impact:** If the transaction throws after the cycle is marked TERMINATED, the filter remains active with a dangling `currentCycleId`.

**Fix:** Move `updateMany` inside the same `$transaction`.

**Status:** FIXED

---

### H3. CORS Fallback Allows Open Origins

**File:** `apps/api/src/app.ts:95`

**Code:**
```ts
origin: (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173,...,capacitor://localhost').split(','),
```

**Risk:** If `ALLOWED_ORIGINS` is not set in production, the fallback includes `capacitor://localhost` and `http://localhost` with `credentials: true`.

**Fix:** Throw on missing `ALLOWED_ORIGINS` when `NODE_ENV=production`.

**Status:** FIXED

---

### H4. EMQX Password `public` in Committed `.env`

**File:** `apps/api/.env:21`

**Risk:** Factory default EMQX credential committed to repo.

**Fix:** Move to `.env.example` with placeholder.

**Status:** NOTED (operational — not code fix)

---

### H5. Missing DB Index — `AssetInstance(organizationId, currentLifecycleState)`

**File:** `apps/api/prisma/schema.prisma`

**Impact:** `getDashboardStats` does `groupBy` without composite index — full table scan as data grows.

**Fix:** Add `@@index([organizationId, currentLifecycleState])`.

**Status:** FIXED

---

## MEDIUM ISSUES (P2)

### M1. `getDashboardStats` — Cross-Org Data Leak

**File:** `filter-operations.service.ts:967-994`

Raw SQL queries for daily/monthly stats have NO `organizationId` filter. Multi-tenant deployments leak aggregate stats.

**Status:** FIXED

---

### M2. JWT Secret Silently Degrades Outside prod/staging

**File:** `apps/api/src/lib/jwt.ts:4-16`

If `NODE_ENV` is anything other than exactly `"production"` or `"staging"`, JWT uses a random ephemeral secret. Every restart invalidates all tokens.

**Status:** NOTED (acceptable for dev)

---

### M3. Swagger Docs Publicly Accessible

**File:** `apps/api/src/plugins/auth.ts:43`

`/docs` and all Swagger sub-paths are fully public. Full API surface exposed.

**Fix:** Gate behind auth in production.

**Status:** FIXED

---

### M4. `$queryRawUnsafe` Pattern Proliferation

17+ usages across backup, config, filter-operations, system-health. All currently parameterized correctly, but one careless string concatenation edit creates SQLi.

**Recommendation:** Migrate to `$queryRaw` tagged template literals.

**Status:** NOTED (future improvement)

---

### M5. Backup `/validate` Accepts 100MB Without Reauth

**File:** `apps/api/src/modules/backup/routes.ts:113`

Only requires `CONFIG_UPDATE` permission, no reauth. A stolen admin token can hammer this endpoint.

**Status:** NOTED

---

## EXCLUDED FROM FIXES (Per User Request)

### SUPER_ADMIN Brute-Force Lockout Exemption

**File:** `apps/api/src/modules/auth/auth.service.ts:108`

SUPER_ADMIN is exempt from lockout. Can be brute-forced at 500 req/min indefinitely. Violates 21 CFR Part 11 §11.300.

**Status:** NOT FIXED (user requested exclusion)

---

## Fix Summary

| # | Issue | Severity | Status |
|---|-------|----------|--------|
| C1 | Hardcoded Admin@123 + Swagger exposure | CRITICAL | FIXED |
| C2 | MQTT timing attack + empty bypass | CRITICAL | FIXED |
| C3 | Rule chain table injection | CRITICAL | FIXED |
| H1 | N+1 queries on filter operations | HIGH | FIXED |
| H2 | retire() partial transaction | HIGH | FIXED |
| H3 | CORS open fallback | HIGH | FIXED |
| H4 | EMQX password in .env | HIGH | NOTED |
| H5 | Missing composite index | HIGH | FIXED |
| M1 | Dashboard stats org leak | MEDIUM | FIXED |
| M2 | JWT secret fallback | MEDIUM | NOTED |
| M3 | Swagger public access | MEDIUM | FIXED |
| M4 | $queryRawUnsafe pattern | MEDIUM | NOTED |
| M5 | Backup validate no reauth | MEDIUM | NOTED |

---

*Generated by Claude Code audit on 2026-04-09*
