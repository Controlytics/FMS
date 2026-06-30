# Phase 5C — Notifications page button gating report

## Button gate matrix

| Button | Old gate | Node | Node gate | New gate | Verdict |
|---|---|---|---|---|---|
| Bulk "Delete Selected" | `isSuperAdmin` (SUPER_ADMIN role check) | `notifications.delete` | `[]` (SA-only) | `can('notifications.delete')` | **SAME** |
| Row single delete (trash icon) | `isSuperAdmin` | `notifications.delete` | `[]` (SA-only) | `can('notifications.delete')` | **SAME** |
| "Mark All as Read" (header) | UNGATED | `notifications.mark` | `['NOTIFICATION_VIEW']` enforce:'c' | `can('notifications.mark')` | **SAME** (all page-viewers have NOTIFICATION_VIEW) |
| Bulk "Mark Read" (toolbar) | UNGATED | `notifications.mark` | `['NOTIFICATION_VIEW']` enforce:'c' | `can('notifications.mark')` | **SAME** (all page-viewers have NOTIFICATION_VIEW) |
| Bulk "Mark Unread" (toolbar) | UNGATED | `notifications.mark` | `['NOTIFICATION_VIEW']` enforce:'c' | `can('notifications.mark')` | **SAME** (all page-viewers have NOTIFICATION_VIEW) |
| Row "Mark Read" | UNGATED | `notifications.mark` | `['NOTIFICATION_VIEW']` enforce:'c' | `can('notifications.mark')` | **SAME** (all page-viewers have NOTIFICATION_VIEW) |
| Row "Mark Unread" | UNGATED | `notifications.mark` | `['NOTIFICATION_VIEW']` enforce:'c' | `can('notifications.mark')` | **SAME** (all page-viewers have NOTIFICATION_VIEW) |

## Notes

- **No CHANGED buttons.** All 7 gated buttons retain identical effective behavior after the refactor.
- `notifications.mark` gate is `['NOTIFICATION_VIEW']`. The route itself is behind a `RequireRole` guard
  that requires `NOTIFICATION_VIEW`, so any authenticated user who reaches this page already satisfies
  the gate. Marking one's own notifications read/unread is never blocked.
- `notifications.delete` gate is `[]` → `useCan()` returns `false` for all non-SA users (rule 3 in
  hook: empty gate → SA-only). This exactly mirrors the removed `isSuperAdmin` check.
- `isSuperAdmin` variable and `const { user } = useAuth()` destructure were both removed (fully unused
  after the refactor). The `useAuth` import was replaced by `useCan`.
- Lint (`tsc --noEmit`) passes clean.
