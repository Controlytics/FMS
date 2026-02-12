# Backend Architecture Decisions

## 1. Role as Enum Column (not separate table)
**Decision:** Store role as a Prisma enum on the `users` table rather than a separate `roles` table with join.
**Rationale:** Phase 1 has 6 fixed roles. This simplifies queries, avoids JOINs on every auth check, and roles are checked on nearly every request. A roles table would add complexity without benefit at this stage. Can be migrated to a table in later phases if custom roles are needed.

## 2. Flat Asset Hierarchy with ltree (via unsPath string)
**Decision:** Use a single `hierarchy_nodes` table with `parent_id` and `uns_path` (stored as varchar, queried with ltree) for the full asset tree.
**Rationale:** The asset_guide.md specifies flexible unlimited-depth hierarchies. A single table with parent-child relationships is simpler than separate tables per level. The `uns_path` field enables fast subtree queries via PostgreSQL's ltree extension. Prisma doesn't natively support ltree, so raw SQL is used for path queries while Prisma handles standard CRUD.

## 3. JWT + DB Sessions (not stateless JWT only)
**Decision:** Issue JWT tokens but also create a `sessions` record in the database.
**Rationale:** 21 CFR Part 11 requires the ability to immediately invalidate sessions (e.g., when admin disables a user, on logout, concurrent session prevention). Pure stateless JWT cannot support instant invalidation. The session DB check on every request adds a small overhead but is essential for compliance.

## 4. SHA-256 Checksum (not full hash chain)
**Decision:** Each audit record gets a SHA-256 checksum of its key fields. Not a chained hash (where each hash includes the previous).
**Rationale:** Full hash chaining requires sequential writes and breaks under concurrent audit logging. The checksum still provides tamper evidence for individual records. The Phase 1 spec references both approaches; we chose individual checksums for reliability under concurrent load. Hash chaining can be added as a background verification job later.

## 5. SUPER_ADMIN Audit Exemption
**Decision:** The audit logger plugin checks `userRole === 'SUPER_ADMIN'` and skips logging entirely.
**Rationale:** Per the business requirements, SUPER_ADMIN is the system owner whose actions are intentionally not recorded. This is a core compliance design choice from the spec documents.

## 6. Password Policy as System Config (not code)
**Decision:** Password policy rules (min length, uppercase count, history depth, etc.) are stored in the `system_config` table and loaded at runtime.
**Rationale:** 21 CFR Part 11 requires configurable password policies that admins can adjust without code changes. Storing in DB with a Zod schema for validation ensures policies are always valid while remaining configurable via the UI.

## 7. Prisma ORM with Raw SQL for ltree
**Decision:** Use Prisma for most database operations, fall back to `$queryRaw` for ltree-specific queries.
**Rationale:** Prisma provides type-safe queries, migrations, and seeding. However, it lacks native ltree support. For subtree queries (descendants, ancestors, path matching), raw SQL is necessary. This hybrid approach gives us the best of both worlds.

## 8. Fastify over Express
**Decision:** Fastify 5 as the HTTP framework.
**Rationale:** Per the Phase 1 tech stack doc. Fastify provides built-in schema validation, plugin system, better performance than Express, and first-class TypeScript support. The plugin architecture cleanly separates auth, audit, and RBAC concerns.
