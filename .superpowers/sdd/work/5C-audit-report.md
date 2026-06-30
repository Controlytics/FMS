# Phase 5C — Audit Trail Button Gating (useCan refactor)

## Status: BLOCKED — export gate mismatch (prior run)

---

## Button audit

| Button | Old gate | Node | `can()` gate value | Same/Changed |
|--------|----------|------|--------------------|--------------|
| Export PDF / Export Excel | `isSuperAdmin \|\| perms.includes('AUDIT_EXPORT')` | `audit.export` | `['AUDIT_READ']` | **LOOSENING** ← BLOCKED |
| Send for Review | `isSuperAdmin \|\| perms.includes('AUDIT_EXPORT')` (same `canExport`) | `audit.export` | `['AUDIT_READ']` | **LOOSENING** ← BLOCKED |
| Select-all checkbox (header) | `isSuperAdmin` | `audit.redact` | `[]` (gate empty → SA-only) | SAME |
| Row checkbox | `isSuperAdmin` | `audit.redact` | `[]` (gate empty → SA-only) | SAME |
| Row View (detail modal) | `isSuperAdmin` | `audit.redact` | `[]` (gate empty → SA-only) | SAME |
| Row Redact (individual) | `isSuperAdmin` | `audit.redact` | `[]` (gate empty → SA-only) | SAME |
| Bulk Delete Selected | `isSuperAdmin` | `audit.redact` | `[]` (gate empty → SA-only) | SAME |
| Selection toolbar visibility | `isSuperAdmin && isSomeSelected` | `audit.redact` | `[]` (gate empty → SA-only) | SAME |

---

## Root cause of the BLOCKED condition (prior run)

`permission-tree.ts` line 237–238 had `gate: ['AUDIT_READ']` — which would have
loosened export access to any AUDIT_READ holder.

Fix applied in commit `3b4da3e`: gate corrected to `['AUDIT_EXPORT']`.

---

## COMPLETED — Run 2 (2026-06-30, commit after 3b4da3e gate fix)

Gate state at implementation:
```ts
{ id: 'audit.export', ..., gate: ['AUDIT_EXPORT'] }  // SA || AUDIT_EXPORT
{ id: 'audit.redact', ..., gate: [] }                 // SA-only
```

### Button → old gate → node → new gate → result

| Button | Old check | Node | Gate | Result |
|--------|-----------|------|------|--------|
| Export PDF | `isSuperAdmin \|\| perms.includes('AUDIT_EXPORT')` | `audit.export` | `['AUDIT_EXPORT']` | **SAME** |
| Export Excel | same `canExport` | `audit.export` | `['AUDIT_EXPORT']` | **SAME** |
| Send for Review | same `canExport` | `audit.export` | `['AUDIT_EXPORT']` | **SAME** |
| Select-all checkbox | `isSuperAdmin` | `audit.redact` | `[]` → SA-only | **SAME** |
| Row checkbox | `isSuperAdmin` | `audit.redact` | `[]` → SA-only | **SAME** |
| Row View button | `isSuperAdmin` | `audit.redact` | `[]` → SA-only | **SAME** |
| Row Redact button | `isSuperAdmin` | `audit.redact` | `[]` → SA-only | **SAME** |
| Bulk Delete Selected | `isSuperAdmin` | `audit.redact` | `[]` → SA-only | **SAME** |
| Selection toolbar | `isSuperAdmin && isSomeSelected` | `audit.redact` | `[]` → SA-only | **SAME** |

No CHANGED buttons. All behavior identical.

### Changes made

- `apps/web/src/routes/audit/index.tsx`:
  - Added `import { useCan } from '@/hooks/use-can'`
  - Added `const can = useCan()`
  - Removed `const isSuperAdmin = user?.role === 'SUPER_ADMIN'`
  - Removed `const perms = user?.permissions ?? []`
  - `canExport` → `can('audit.export')`
  - Selection toolbar condition → `can('audit.redact') && isSomeSelected`
  - `<AuditTable isSuperAdmin={...}>` → `isSuperAdmin={can('audit.redact')}`
  - `<AuditDetailModal isSuperAdmin={...}>` → `isSuperAdmin={can('audit.redact')}`
- `apps/web/src/routes/audit/components/audit-table.tsx`: **not modified** (prop interface kept; value computed in parent)

### Lint

`npm run lint -w @digilog/web` → clean (tsc --noEmit, no errors)
