# Re-auth coverage sweep (2026-09-24)

Operator: "in reauth configuration, so many actions were not added — report
downloading, tab operations, … check the entire application; every operation
must have a re-auth selection at configuration, and if selected the password
must be asked at that operation."

## Findings (inventory script: `scratchpad/reauth_inventory.cjs`)

- 204 backend mutation routes; **96 had no re-auth gate**.
- Catalog rows with NO enforcement (inert): `UPDATE_SESSION_CONFIG`,
  `UPDATE_DATETIME_CONFIG` (dynamic-config derives `UPDATE_SESSION` /
  `UPDATE_DATETIME` from the module key — never matched the row).
- Enforced but missing from the catalog: `TOGGLE_SUPER_ADMIN_API_ACCESS`.
- **Report downloads never touched a gate**: PDF/Excel are generated client-side
  from loaded data; the only server call is `POST /api/audit/report-export-log`
  (audit row), which was ungated.
- Tablet: the six scan stations all rode on `ADVANCE_FILTER_STAGE` /
  `START_CLEANING_CYCLE`; no per-station selection.
- Web pages calling gated endpoints WITHOUT `useReauth` (a gate would surface as
  a bare 401): user-id, roles tabs, role-assignments, pagination, report-labels,
  report-page-titles, export-options, replacement-schedule-filters,
  notification-rules, notification-logs, debug.

## Design

1. **Catalog** (`packages/shared/src/types/reauth-actions.ts`), +28 → 128:
   - Reports ×12 `EXPORT_*` (one per report name) + `REPORT_EXPORT_ACTIONS`
     map (report name → action) shared by API and web.
   - Filter stages ×6 `STAGE_WASH_IN … STAGE_STORAGE_OUT` — enforced IN ADDITION
     to the generic actions on `/advance`, `/advance-with-checklist`,
     `/bulk-operate` (per item, from `targetState`).
   - `REQUEST_BLOCK_CHANGE`, `RESUBMIT_FILTER`, `UPLOAD_REPLACEMENT_SCHEDULE`,
     `CREATE_ADMIN_REQUEST`, `SUBMIT_REPORT_REVIEW`, `MANAGE_NOTIFICATION_RULES`,
     `MANAGE_USER_GROUPS`, `DELETE_NOTIFICATION_LOG`, `MANAGE_DEBUG_TRACES`,
     `TOGGLE_SUPER_ADMIN_API_ACCESS` (always-on, informational row).
2. **Config pages**: every dynamic def gets `requiresReauth: true` +
   `reauthAction` (`UPDATE_CONFIG_PAGE` umbrella, or its own catalog row where
   one exists: session, datetime). Static config routes without a gate →
   `enforceReauth('UPDATE_CONFIG_PAGE')`.
3. **Report exports**: `POST /api/audit/report-export-log` enforces
   `REPORT_EXPORT_ACTIONS[reportType]`; the two backend `.xlsx` GETs enforce the
   same via the `x-reauth-password` header. Web: one helper
   `exportWithReauth(reauth, input, warn, generate)` in
   `lib/report-export-log.ts`; the log write is the signed act and happens
   BEFORE the file is produced. Re-auth errors are never swallowed by the
   fail-open offline path.
4. **Hook**: `useReauth().execute` / `executeWithResult` accept
   `string | string[]` (prompt if ANY needs it) so callers pass
   `[generic, STAGE_X]`.
5. **Frontend wiring** for every newly gated endpoint + the pages above.

## Not gated on purpose

Auth flows (login/logout/refresh/verify/forgot/change-password — the last already
takes the current password), offline-grant, guest cleaning request, photo
upload, mark-read/unread, previews/validators (`*/validate`, `user-id/validate`),
diagnostics (`*/test`, `test-url`, `test-connection`, `fetch-readings`),
POST-shaped reads (`ahu-completion-status/batch`, `ahu-set-availability`), the
super-admin data console (already `SUPER_ADMIN_DATA_EDIT` via `manual-change.ts`
+ `enforceReauthAlways` on the API toggle), dashboards + notification templates
(no web caller), cron sweeps (no web caller).

## Checklist

- [x] 1 shared catalog (100 → **127**; `CREATE_ADMIN_REQUEST` dropped — the
      route is public) + hook `string | string[]` + `pendingActionLabel`
- [x] 2 API gates (codemod `scratchpad/reauth_codemod.cjs` + hand edits for the
      stage routes, `bulk-operate.ts`, the two `.xlsx` GETs, config defs).
      Skipped on purpose: the no-op `debug/entity/:id/toggle`.
- [x] 3 web wiring: `requireExportReauth` on 12 export pages, `signOnce` on the
      five Filter Operations loops, tablet `runBulkOnline` arrays, 11 config /
      admin pages via `<ReauthPrompt>`, block-change (web + tablet), resubmit
- [x] 4 tests + docs: API 384 (subset) / web 842 / shared 336 green; CLAUDE.md,
      packages/shared/CLAUDE.md, CHANGELOG, memory
- [x] 5 live (`scratchpad/pw/verify_reauth.cjs`, 13 checks): MANAGER Audit Trail
      PDF export prompts, refuses a wrong password, downloads after the right
      one; ADMIN User ID config save prompts; OPERATOR `/advance` + `/bulk-operate`
      to DRY_IN → 401 REAUTH_REQUIRED while WASH_OUT (row off) is not gated;
      `report-export-log` 401 without / 200 with password. The block-change
      gate could NOT be exercised by a non-SA role: no role holds
      `BLOCK_CHANGE_REQUEST` (the approval flow was retired 2026-06-09, so the
      permission preHandler 403s first). The gate is the same one-liner as the
      others and is covered by tsc; it will bite the moment a role is granted
      the permission.

**Harness note:** the re-auth dialog's password field has autofill prevention —
Playwright keystrokes never reach React state. Set the value through the native
setter + `input` event and click "Verify & Continue" natively (same quirk as the
login page, see memory `feedback_playwright_login_autofill_quirk`).
