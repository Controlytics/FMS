# Backend Architecture Decisions

## 1. Role as Enum Column (not separate table)
**Decision:** Store role as a Prisma enum on the `users` table rather than a separate `roles` table with join.
**Rationale:** Phase 1 has 6 fixed roles. This simplifies queries, avoids JOINs on every auth check, and roles are checked on nearly every request. A roles table would add complexity without benefit at this stage. Can be migrated to a table in later phases if custom roles are needed.

## 2. Template-Based Asset Architecture (not hardcoded hierarchy)
**Decision:** Assets are created from configurable templates (blueprints) rather than hardcoded Block > Area > Module > Instrument hierarchy tables.
**Rationale:** The requirements doc specifies flexible asset types (CCTV cameras, clean rooms, reactors, etc.) that vary per deployment. Templates define attribute schemas (with 9 data types and numeric constraints), telemetry schemas, expected identifiers, expected relationships, and status lifecycles. Instances are created from templates and validated against their schema. This supports unlimited asset types without schema changes.

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

## 7. Prisma ORM with JSONB for Flexible Schemas
**Decision:** Use Prisma for all database operations. Asset template schemas and instance attribute values stored as JSONB columns.
**Rationale:** Prisma provides type-safe queries, migrations, and seeding. JSONB columns allow each template to define its own attribute schema without requiring database migrations per template. Validation happens at the API layer using the template's attributeSchema definition. This gives flexibility while keeping the database schema stable.

## 8. Fastify over Express
**Decision:** Fastify 5 as the HTTP framework.
**Rationale:** Per the Phase 1 tech stack doc. Fastify provides built-in schema validation, plugin system, better performance than Express, and first-class TypeScript support. The plugin architecture cleanly separates auth, audit, and RBAC concerns.

## 9. Dynamic Roles via Database (not hardcoded enum)
**Decision:** Roles are stored in a `roles` table with dynamic properties (name, displayName, color, hierarchyLevel, permissions). Role validation uses `z.string()` instead of `z.enum()`.
**Rationale:** Custom roles (e.g., "QA", "ENGINEER") need to be created by SUPER_ADMIN without code changes. Hardcoded Zod enums and `CREATABLE_ROLES` were replaced with dynamic DB lookups that check role existence and hierarchy level at runtime.

## 10. Action Re-authentication with In-Memory Cache
**Decision:** Re-authentication config (`action-reauth`) is loaded from DB with a 10-second in-memory cache. Cache is invalidated on config update.
**Rationale:** Re-auth checks happen on every sensitive mutation. Hitting the DB on every request would be expensive. A short TTL cache provides good performance while ensuring config changes take effect quickly.

## 11. Configurable Audit Text Templates
**Decision:** Audit trail action descriptions are stored as configurable templates in `system_config`, with defaults defined in the shared package.
**Rationale:** Different organizations may want different wording for audit entries. Templates use a placeholder system (`{actor}`, `{targetUser}`, etc.) that gets replaced at display time. Defaults are always available as fallback.

## 12. Configurable Pagination
**Decision:** Per-page record count options are stored in `system_config` as a 3-element tuple, configurable by SUPER_ADMIN.
**Rationale:** Different deployments may have different data volumes. A single centralized config (rather than per-page hardcoded values) ensures consistency across all paginated views.

## 13. Bidirectional Relationships with Auto-Inverse
**Decision:** When creating an asset relationship (e.g., A CONTAINS B), the API automatically creates the inverse (B CONTAINED_IN A). Deleting either side deletes both.
**Rationale:** Bidirectional relationships are essential for navigating the asset hierarchy from either direction. Auto-inverse creation prevents orphaned one-way relationships. The INVERSE_RELATIONSHIP_MAP in the shared package defines all inverse pairs: CONTAINS<->CONTAINED_IN, FEEDS<->FED_BY, DEPENDS_ON<->DEPENDED_ON_BY, BACKS_UP<->BACKED_UP_BY, MONITORS<->MONITORED_BY, CONNECTED_TO<->CONNECTED_TO (symmetric).

## 14. CONTAINS Cycle Detection
**Decision:** Before creating a CONTAINS relationship from A to B, the API walks the parent chain from A to detect if B is already an ancestor of A.
**Rationale:** Circular containment (A contains B contains A) would create infinite loops in the tree view and break the parent-child hierarchy. The `hasContainsCycle()` helper performs an iterative ancestor walk via DB queries, returning true if a cycle is detected. The API returns 400 if a cycle would be created.

## 15. Template Versioning with Snapshots
**Decision:** Each template update creates an AssetTemplateVersion record containing a full JSON snapshot of the template at that point in time.
**Rationale:** Asset instances record which template version they were created from (`templateVersion` field). When a template is updated, existing instances should still reference the schema they were created against. Full snapshots avoid complex diff/migration logic and allow viewing the exact template definition at any point in history.

## 16. Paginated API Responses
**Decision:** List endpoints return `{ data: [], total, page, limit, totalPages }`. Tree endpoints return plain arrays.
**Rationale:** Pagination is essential for large datasets. The consistent wrapper format makes it easy for the frontend to handle pagination state. Tree endpoints return flat arrays because they return the full hierarchy (no pagination needed) and the frontend builds the tree structure client-side.

## 17. requirePermission vs requireRole for Authorization
**Decision:** Asset routes use `requirePermission` (checks `role.permissions` JSON array in DB). Other routes may use `requireRole` (checks role name string).
**Rationale:** Permission-based checks are more granular and support custom roles. A role named "QA" can have `ASSET_CREATE` permission without needing to be listed in a hardcoded role-name allow list. `requirePermission` fetches the role from DB on each request and checks the `permissions` JSON array. `requireRole` is a simpler name-based check used where role identity matters (e.g., SUPER_ADMIN bypass logic). Both are Fastify decorators registered by the rbac plugin.

## 18. Reauth Enforcement on Mutations
**Decision:** Asset mutation endpoints call `enforceReauth()` from `src/lib/reauth-check.ts` after permission checks. Read endpoints do not require reauth.
**Rationale:** Re-authentication adds a second verification step before destructive or sensitive operations. The reauth config is action-based (e.g., `CREATE_ASSET`, `DELETE_ASSET_TEMPLATE`) and can be enabled/disabled per action by admins. The `enforceReauth` function checks the in-memory cache (10s TTL) to determine if the action requires reauth, and validates the provided password if so.

## 19. Cascade Soft-Delete for Asset Instances
**Decision:** Deleting an asset instance soft-deletes (sets `isActive: false`) all descendant instances by recursively collecting child IDs via `collectDescendantIds()`.
**Rationale:** Hard-deleting parent assets while leaving orphaned children would create an inconsistent hierarchy. Soft-delete preserves data for audit purposes while removing items from active views. The recursive helper walks the `parentId` tree to collect all descendants before performing a batch update.

## 20. Template Linking Rules with Scoped Priority
**Decision:** Template linking rules use a 3-tier scoped priority system (USER > ROLE > GLOBAL) to control which relationship types are allowed between template pairs. When no rules exist, all relationships are allowed (backwards compatible).
**Rationale:** Different organizations need different levels of control over asset relationships. Global rules set baseline policy, role-scoped rules allow per-team customization, and user-scoped rules handle exceptions. The priority system (USER=20, ROLE=10, GLOBAL=0) ensures the most specific rule wins. Backwards compatibility (no rules = allow all) ensures existing deployments are unaffected.

## 21. API-Level Duplicate Rule Prevention (PostgreSQL NULL Workaround)
**Decision:** Template linking rule creation uses an explicit `findFirst` check before `create` instead of relying solely on the `@@unique` constraint.
**Rationale:** The `@@unique([sourceTemplateId, targetTemplateId, scope, scopeValue])` constraint does not prevent duplicates when `scopeValue` is NULL because PostgreSQL treats NULL values as distinct in unique constraints. An explicit `findFirst` query before `create` catches duplicates for GLOBAL scope rules (where `scopeValue` is always NULL) and returns HTTP 409.

## 22. Role-Level Cross-Template Linking Bypass
**Decision:** Roles have an `allowCrossTemplateLinking` boolean field. When true, all template linking rules are bypassed for users with that role.
**Rationale:** Administrators and certain privileged roles need the ability to create any relationship regardless of template linking rules. Rather than creating exception rules for every template pair, a single role-level toggle provides a clean override. The check is performed at request time from the DB (not cached), so role changes take effect on the next API call.

## 23. Dual Hierarchy: parentId vs CONTAINS Relationships
**Decision:** The asset system maintains two independent hierarchies: `parentId` (direct field on AssetInstance) and CONTAINS relationships (in AssetRelationship table). The sidebar tree uses `parentId`, while the diagram tree uses CONTAINS relationships.
**Rationale:** `parentId` provides a simple, fast single-parent hierarchy for the sidebar navigation tree. CONTAINS relationships provide a richer, many-to-many containment model visible in the Relationships tab diagram. Both serve different UI purposes. The "Unlink from Parent" action sets `parentId=null`, while "Remove from Tree" in the diagram deletes the CONTAINS relationship.
