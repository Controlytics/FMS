# Strict audit — non-SUPER_ADMIN surface (2026-09-04)

Operator ask: complete, strict audit for bugs / broken / dead connections /
"other reviews", skipping SUPER_ADMIN role and functionality.

Rule for this audit: **nothing goes in the report unverified.** A static
finding must be reproduced live (API or browser) or it is dropped/downgraded.

## Passes

- [x] A1 — Backend route + gate inventory (381 routes; brace-matched, not windowed)
- [x] A2 — Frontend API-call inventory (301 calls, 168 distinct)
- [x] A3 — Cross-check: **0 dead connections** (15 candidates, all live-verified as artefacts)
- [x] A4 — Strict response schemas: 22 hits, all request-body or fully-read; no strip bug
- [x] B1 — Per-role API smoke: 128 reachable GETs × 6 temp users (one per role).
      **0 × 5xx.** 10 status-0 cells re-probed 3× each → all real statuses (they
      coincided with tsx-watch restarts while patching). Non-200/403 breakdown:
      19 × 400 = missing required query params (`user-lookup`, `filter-upload-template.xlsx`,
      `action-reauth/check`) + 1 × `notification-rules/:id` (see #7);
      1 × 401 = `backup/export` reauth-required by design; 42 × 404 = substituted
      id of the wrong entity type. Temp users deleted (verified 0 remaining).
- [x] B2 — Per-role browser sweep (headless Chromium, token injected into
      sessionStorage): 6 roles × every sidebar page = 63 page loads.
      **0 page errors, 0 error boundaries, 0 redirects.** Two distinct failing
      calls only (#8, #9), both fixed; re-sweep after the fixes: 63/63 clean.
- [x] C  — Re-verified the 32 open Mediums (5 out of scope: M06 M07 M50 M51 M76)
- [x] D  — Fixed confirmed bugs; the rest reported with evidence

## Findings (verified) and what was done

| # | sev | where | what | status |
|---|---|---|---|---|
| 1 | Med | `POST /api/backup/restore` catch-all | any unmatched error → 500 RESTORE_FAILED, incl. Fastify's own 406 multipart error | **fixed** (4xx passed through; verified 406 live) |
| 2 | Low | `POST /api/audit/report-export-log` | any authenticated user can write a REPORT_GENERATED audit row with caller-supplied reportType/recordCount (self-attributed) | **fixed** (reportType allow-listed; verified 400 live) |
| 3 | Low | `GET /api/admin-requests/user-lookup` (public, rate-limited) | pre-login exact employee-ID existence check returns fullName; by design for contact-admin | **fixed** (name masked; request resolves the real name server-side) |
| 4 | Info | `GET /api/replacement-schedules/{due,tasks,blocked-filters}` | ungated by design; ADMIN/QA can read replacement tasks via API though the doc gives them no Replacement List | **fixed** (VIEW or OPERATE required; ADMIN 403 live) |
| 5 | Med | `/api/filters/{events,cycles,cleaning-record,manual-status-changes}` | `page=-1` / `limit=0` reached Prisma → 500 | **fixed** (schema `minimum`; verified 400 live). Regression: the `maximum: 100` added with it 400'd the tablet cycles view (`limit=200`, clamped to 100 by the service for months) - removed same day |
| 6 | Med | AHU dashboard "Recent Activity" (M89) | queried `/api/filters/events?filterId=<AHU id>` — events are per filter, so always empty | **fixed** (`ahuId` param resolves child filters; 43 rows live, random uuid → 0) |
| 7 | Info | `GET /api/notification-rules/:id` unknown id | 400 DATA_CONSTRAINT instead of 404 (findUniqueOrThrow). No FE caller of the GET | **fixed** (404 NOT_FOUND; verified live) |
| 8 | Med | `GET /api/config/report-labels/current` | gated CONFIG_READ but read by every report page for every role → 403 + SWR error on 22 of 63 page loads | **fixed** (all-authenticated, same contract as page-titles) |
| 9 | Low | `triggerSync('app-start')` + 60 s poll | roles without ASSET_VIEW/FILTER_OPERATE (ADMIN) 403 on `/api/sync/since` at start and every poll | **fixed** (gated on the user's permissions) |

## Phase C — the 32 open Mediums, verdicts

Fixed this session: **M15** (cleaning-profiles PUT items schema), **M23**
(filter-profiles PUT constraints), **M58** (contact-admin blank Email/Department/
Role/Status rows — lookup returns username + fullName only), **M62** (DRY_OUT
badge text-amber-200 → 700), **M70** (audit search debounced 300 ms), **M88**
(cleaning-profile search server-side; was current page only), **M89** (#6),
**M90** (`filterTemplateIds` Set memoised).

Already closed on re-check: M11, M29 (400s), M32, M74, M87.

**M27 CLOSED 2026-09-04** (was 6 by then: legacy delete path now refuses a
mid-cycle filter with 409; the six stranded cycles were ended through the
audited console edit). Open, reported: **M30** (visibility rule duplicated in service +
repository + single-read), **M47** (`delete()` lacks isSystem guard; gate
ROLE_MANAGE, SA-only in practice), **M63/M79/M82** (history / pm-schedules /
admin-requests never render a fetch error), **M80** (orphan
`/pm-schedules/:entityId` route). Latent: **M55** (0 photos on disk). Out of
scope (SUPER_ADMIN): M06 M07 M50 M51 M76.

## Test evidence

- API: filter-operations + cleaning-profiles + filter-profiles + backup →
  23 files, 254 passed, 4 skipped. Config/sync/notification-rules run after #8.
- Web: 63 files, 816 passed. `tsc --noEmit` clean on both apps.
- `vite build` rebuilt after the FE edits.

## False positives caught (recorded so they are not re-raised)

- Dashboard `PUT /:id` / widget writes "ungated" — windowed grep stopped before a
  long schema; they gate on `DASHBOARD_MANAGE`. Inventory rewritten to brace-match.
- 15 "dead" FE calls — `fetch(apiUrl())` POSTs logged as GET, runtime-generated
  `/api/config/dynamic/*` + un-suffixed config paths, bare `/` root routes.
- B1 status-0 cells — my own API restarts, not server faults (re-probed clean).
- The per-role page sweep covered SIDEBAR pages only; the tablet `/m` views were
  not in it, which is how the `limit=200` regression got past. Next sweep must
  include the tablet views with the exact params they send.

## Follow-up the same day - every record cap removed (operator decision)

See the CHANGELOG entry "Every record cap removed, backend and web
(2026-09-04)" for the full removed / kept lists. Rule going forward: no
`maximum` on limit, no `Math.min(limit, N)`, no hard `take: N` on a list, no
`maxItems` on a bulk action, no `.slice(0, N)` on a rendered data list. Fetch-all
web calls use `ALL_ROWS` from `lib/page-size.ts`.

---

# Dry In: multi-select duration + temperature, auto-fetch on half time (2026-09-04)

Operator ask (confirmed 3 assumptions: edited fetched value recorded as
AUTO_OVERRIDDEN; per-filter half-time; fetch failure -> manual fallback).

- [x] A. Backend: `readingSources` on advance + bulk payloads; `source` stored per reading in the event
- [x] B. Shared hook `useDryerAutoFetch`: auto-start at half time, no Get Values, editable -> AUTO_OVERRIDDEN
- [x] C. Desktop: queue checkboxes + one DRY_IN duration dropdown; drying panel checkboxes + one temperature + change value + Submit selected (bulk)
- [x] D. Tablet: same on the scan queue and the Currently Drying panel
- [x] E. Tests (hook 14/14, web 820/820), typecheck both apps, desktop live check (source AUTO + AUTO_OVERRIDDEN in filter_events), CHANGELOG, commit
- [ ] F. Tablet half-time fetch + submit - operator testing (queue/duration/partial submit already verified)
