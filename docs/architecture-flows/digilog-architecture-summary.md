# DigiLog Architecture — Summary (Basic Flows)

**Quick-reference companion.** Basic flow diagrams + the essentials for the 21 CFR Part 11 admin surface.
For full field tables, edge cases and the verification matrix, see **`digilog-architecture.md`**.

- **Stack:** Fastify (TS) · React/Vite SPA · PostgreSQL 18 · graphile-worker
- **Scope:** user management/RBAC, audit trail, password policy, re-auth, notifications, backup/restore,
  configuration, electronic signatures. **Filter-management (FMMS) excluded — separate project.**
- Tiers in diagrams: FE = frontend · BE = backend · DB = database · WK = worker.

---

## System overview

```mermaid
flowchart LR
  FE["React SPA\nuseCan · useReauth"] -->|"JWT + x-reauth-password"| G["3 gates\nauth → rbac → reauth"]
  G --> H["Handler\nroute→service→repo"]
  H --> DB[("PostgreSQL")]
  H --> AUD["audit (hash chain)"] --> DB
  WK["cron: expiry · pm-overdue · session-sweep"] --> DB
  SH["packages/shared\nPERMISSION_TREE"] -.-> G
```

Every call passes three gates, then the handler writes data + a hash-chained audit row in one transaction.

---

## Data model (core links)

```mermaid
erDiagram
  ROLE ||--o{ USER : "by name (soft)"
  USER ||--o{ SESSION : "FK cascade"
  USER ||--o{ PASSWORD_HISTORY : "FK cascade"
  USER ||--o{ AUDIT_TRAIL : "actor (soft)"
  USER ||--o{ NOTIFICATION : "soft"
  ROLE ||--o| ROLE_CONFIG : "toggles"
  SYSTEM_CONFIG }o..o{ ROLE : "keyed blobs"
```

Roles join by **name string** (soft); sessions/password-history are **hard FK cascade**; audit actor is a plain
varchar so deleting a user never rewrites history.

---

## 1. User management & RBAC

```mermaid
flowchart LR
  A["Create/login/role change"] --> B["Gate: permission + reauth"]
  B --> C["Escalation guards\nno self/above · hierarchy"]
  C --> D["Mutation + audit"]
  D --> E{"role/status change?"} -- yes --> F["invalidate sessions"]
```

- **RBAC config = SUPER_ADMIN** (roles, action-reauth, access-matrix). User ops (create/enable/reset) delegatable to ADMIN.
- Two layers: feature toggles → rebuild `roles.permissions`; request-time `hasEffectivePermission` (`_MANAGE`→CRUD).
- Key endpoints: `POST/GET/PUT/DELETE /api/users`, `POST /api/auth/login`, `POST /api/auth/change-password`,
  `GET/PUT/DELETE /api/roles/:name`, `PUT /api/config/roles/:role`.

---

## 2. Audit trail (hash chain)

```mermaid
flowchart LR
  M["Mutation (same tx)"] --> L["advisory lock"] --> P["read prev checksum"]
  P --> H["checksum = hash(row + prevChecksum)"] --> I["INSERT chain_position"]
  I --> R{"redact vs delete"}
  R -- redact --> RK["null payload · chain VALID"]
  R -- delete --> DK["physical · chain BREAKS (loud)"]
```

- Trigger `audit_trail_no_delete` blocks physical deletes; delete endpoints disable it per-tx.
- `GET /api/audit`, `GET /verify-chain` (SA), `POST /:id/redact`, `DELETE /:id` (AUDIT_DELETE).

---

## 3. Password policy & expiry

```mermaid
flowchart LR
  S["change-password"] --> V["length · complexity · reuse · bcrypt"]
  L["login"] --> E{"expired? (anchor = max(changedAt, policy.updatedAt))"}
  E -- yes --> F["forcePasswordChange"]
  W["daily cron"] --> N["warn / expired notice"]
```

- Expiry derived live from policy; `policy.updatedAt` grace floor avoids mass lockout.
- `GET /api/config/password-policy/current`, `PUT /api/config/password-policy`, `POST /api/auth/change-password`.

---

## 4. Re-authentication

```mermaid
flowchart LR
  A["gated action"] --> Q{"reauth required for role?"}
  Q -- yes --> P["password via x-reauth-password"]
  P --> V["verify (shared login lockout)"] --> M["mutation + signatureMeaning"]
```

- `action-reauth` config maps `{ACTION: [roles]}`. `enforceReauthAlways` = unconditional (audit/report signing).

---

## 5. Notifications

```mermaid
flowchart LR
  T["events: lock · user · pm-overdue · expiry"] --> C["createNotification (sync)"]
  C --> VIS{"visibility by role"}
  VIS --> UI["bell (30s poll) + /notifications"]
```

- Written synchronously (queue task is a dead drain). Delete requires `NOTIFICATION_DELETE`, audited fail-closed.

---

## 6. Backup & restore

```mermaid
flowchart LR
  EX["export: discover tables · strip hashes · json/bak/sql/csv + checksum"]
  RE["restore: verify checksum + audit chain → refuse if incomplete/tampered"]
  RE --> TX["TX: disable triggers · TRUNCATE · insert FK-safe · re-apply hashes · resync seq"]
```

- Ephemeral downloads (no stored model). `BACKUP_RESTORE` must be granted explicitly (not implied by `BACKUP_MANAGE`).
- `GET /api/backup/export`, `POST /api/backup/validate`, `POST /api/backup/restore`.

---

## 7. Configuration

```mermaid
flowchart LR
  B["startup: register 36 defs · seed system_config"]
  F["PUT config + reauth"] --> M["shallow-merge · Zod · upsert"] --> CS["consumers: policy · reauth · rbac"]
```

- Def-driven; partial shallow-merge (a tab won't reset other fields); corrupt blob → schema defaults.
- Security/user/notification defs (SA-gated): `roles`, `action-reauth`, `access-matrix`, `audit-templates`,
  `notification-rules/-email/-sms`, `qnn-notifications`; plus `password-policy`, `session`, `login-security`, `user-id`.

---

## 8. Electronic signatures

```mermaid
flowchart LR
  G["generate (unsigned)"] --> PR["PENDING_REVIEW (snapshot frozen)"]
  PR --> R["review: reauth + SoD (≠ generator)"] --> PA["PENDING_APPROVAL"]
  PA --> AP["approve: reauth + SoD (≠ gen & reviewer)"] --> OK["APPROVED + audit"]
```

- Signature = reauth (act) + `signatureMeaning` (intent, in hash chain) + ReportReview `*By/*At` (record).
- **Gaps:** no per-user PKI; `signatureMeaning` not shown in UI; Stage-1 "Printed By" unsigned.
- `POST /api/report-reviews`, `POST /:id/review` (always REVIEW_REPORT), `POST /:id/approve` (always APPROVE_REPORT).

---

## Verification snapshot (verified 2026-07-18, branch RFID)

| Area | Result |
|---|---|
| RBAC counts (102 perms · 83 privileges · 92 reauth · 27 sidebar) | ✅ verified |
| PERMISSION_TREE single source + frozen-snapshot drift lock | ✅ verified |
| Config (36 defs, all routes, 15 user/security/notif defs) | ✅ verified |
| **GAP:** system roles deletable (no `isSystem` guard) | ⚠️ `role.service.ts:346` |
| **GAP:** role-delete skips caller-hierarchy guard | ⚠️ `role.service.ts:346` |
| E-signatures: no per-user PKI; meaning not in UI | ⚠️ known |

---

*Summary of the compliance/admin surface (filter-ops excluded). Full detail: `digilog-architecture.md`.*
