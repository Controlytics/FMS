# Remove block-change REQUEST/APPROVAL concept (2026-06-09)

User chose option A: full tear-out incl. DB + offline. KEEP the cross-block
operator **confirm** (validateBlockChange→BLOCK_CHANGE_CONFIRM, the confirm dialog,
current-state blockChangeStatus MATCH|CONFIRM). REMOVE only the request/approve flow.

## Checklist
- [x] BE module: delete `modules/block-change-requests/` + app.ts register/import
- [x] BE config: delete `config/defs/block-change-approval.def.ts` + config-discovery import + config/index.tsx card
- [x] BE refs: role.service labels, notification.service types, super-admin/routes
- [x] Shared: permissions BLOCK_CHANGE_REQUEST/APPROVE, privileges block_change.*, reauth APPROVE/REJECT_BLOCK_CHANGE, sidebar-items 'approvals', sidebar-privilege-map → rebuild
- [x] FE: delete use-block-change-approval hook; remove approvals views in mobile-operations + mobile-wrapper; filter-data-management block-change tab
- [x] Offline: offline-store Tombstone 'block-change-request'; sync-engine tombstone branch
- [x] Prisma: drop model BlockChangeRequest + enum BlockChangeStatus + migration
- [x] Seed: remove BLOCK_CHANGE_* from roles + block-change-approval config + help
- [x] DB: drop table/enum; strip perms from roles; delete config row
- [x] Tests: phase2-filter-operations, get-current-state, dialog-state-property, api-client-reauth-shape
- [x] typecheck (api/web), build shared, rebuild APK
