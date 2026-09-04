# Filter Data Management console - verification (2026-09-04)

Operator ask: "check all the options in the filter data management in all pages;
when data was changed there, do the records change on the main pages and in the
DB; do the proper test and give results."

**Method.** `digilog_db` was cloned with pg_dump into `digilog_fdm_test` (513
assets, 678 cycles, 6,072 events, 86 PM entries, 1,357 notifications, 15 admin
requests, 19,477 audit rows) and a second API instance was started on :3002
against the clone, so every write below ran on real data with **zero writes to
the live hash-chained audit trail**. Each console action was then checked three
ways: the DB row (psql), the endpoint the user-facing page reads (Cleaning
Record, cycle detail, Lifecycle list, Filter Traceability, PM Schedules + detail,
Notifications, Admin Requests, Block Changes, Retirement List, Replacement List,
Filters page, Audit Trail detail), and the audit row the write must leave.
Scripts: scratchpad `audit/fdm_test.py`, `fdm_retest.py`; raw results
`fdm-results.json`, `fdm-retest.json`. The clone DB and :3002 process were
removed afterwards.

**Verdict: 110 PASS, 0 FAIL, 6 INFO.** Every tab's create / edit / delete
(and unretire, redact, permanent delete) writes the DB, shows on the main page
that reads that data, and leaves its audit row. One defect found and fixed: an
invalid enum value sent to a console write came back as a 400 whose message was
a raw Prisma invocation dump (the dialogs only offer valid values, so API-only);
it now answers `400 INVALID_VALUE` naming the allowed values.

## Results

| Tab | Check | Result | Evidence |
|---|---|---|---|
| Cleaning Cycles | EDIT reason label + justification -> HTTP | PASS | 200 |
| Cleaning Cycles | DB row updated | PASS | FDM Test Reason\|fdm-edit |
| Cleaning Cycles | Cycle DETAIL page (/filters/cycles/:id) shows it | PASS | FDM Test Reason |
| Cleaning Cycles | Cleaning RECORD page (/filters/cleaning-record) shows it | PASS | FDM Test Reason |
| Cleaning Cycles | Lifecycle / traceability list (/filters/cycles) shows it | PASS | FDM Test Reason |
| Cleaning Cycles | Audit MANUAL_RECORD_UPDATED written | PASS | 1 |
| Cleaning Cycles | EDIT status COMPLETED->TERMINATED; record page status | PASS | [200, 'TERMINATED'] |
| Cleaning Cycles | (documented gap) FilterDetails lifecycle NOT reconciled by a status edit | INFO | CLEANING_CYCLE_COMPLETED\|NULL |
| Cleaning Cycles | CREATE manual cycle -> HTTP + id | PASS | [200, "{'id': '83700a62-8e15-4d9f-856b-54b91401f1e5', 'cycleCode': 'MANUAL-1-MTMU25AM',"] |
| Cleaning Cycles | DB row exists (manual_entry) | PASS | COMPLETED\|MANUAL-1-MTMU25AM |
| Cleaning Cycles | Cleaning RECORD page lists it | PASS | 1 |
| Cleaning Cycles | Lifecycle list lists it | PASS | 1 |
| Cleaning Cycles | Audit MANUAL_RECORD_CREATED written | PASS | 1 |
| Filter Events | EDIT remarks + first reading value -> HTTP | PASS | [200, 'reading 1.7 -> 9.9'] |
| Filter Events | DB row updated | PASS | FDM event edit\|9.9 |
| Filter Events | Events list / traceability timeline (/filters/events) shows it | PASS | FDM event edit |
| Filter Events | Cycle DETAIL page embeds the edited event | PASS | FDM event edit |
| Filter Events | Cleaning RECORD row carries the new reading (9.9) | PASS | found |
| Filter Events | Audit MANUAL_RECORD_UPDATED written | PASS | 1 |
| Filter Events | CREATE manual event on the manual cycle -> HTTP + id | PASS | [200, "{'id': 'fd8b5ed2-0d62-445c-b200-bb227b04b0e7', 'filterId': 'f7f0d005-383f-48b8-8"] |
| Filter Events | DB row exists (manual_entry, checksum set) | PASS | true\|e38a5988 |
| Filter Events | Traceability events list (/filters/events?filterId) lists it | PASS | 1 |
| Filter Events | Cycle DETAIL of the manual cycle embeds it | PASS | 1 |
| Filter Events | Audit MANUAL_RECORD_CREATED written | PASS | 1 |
| Filter Events | DELETE manual event -> HTTP, DB gone, list no longer shows it | PASS | [200, True] |
| Filter Events | Audit MANUAL_RECORD_DELETED written | PASS | 1 |
| Cleaning Cycles | DELETE manual cycle -> HTTP, DB gone, record page no longer lists it | PASS | [200, True] |
| Cleaning Cycles | Audit MANUAL_RECORD_DELETED written | PASS | 1 |
| PM Entries | EDIT toleranceDays 25->7 + notes -> HTTP | PASS | 200 |
| PM Entries | DB row updated | PASS | 7\|FDM pm edit |
| PM Entries | PM SCHEDULES page (/pm-schedules/entries?year=) shows it | PASS | 7 |
| PM Entries | PM schedule DETAIL page (/pm-schedules/:entityId) shows it | PASS | [200, 7] |
| PM Entries | Audit MANUAL_RECORD_UPDATED written | PASS | 1 |
| PM Entries | CREATE manual PM entry (Mar 2026) -> HTTP + id | PASS | [200, "{'id': '5626e477-94e5-48f9-a9df-11c5058323d2', 'scheduleId': '8eee5652-7ddb-4caf"] |
| PM Entries | DB row exists (manual_entry, window defaulted) | PASS | 2026-03-15\|APPROVED |
| PM Entries | PM SCHEDULES page lists it | PASS | 87 |
| PM Entries | Audit MANUAL_RECORD_CREATED written | PASS | 1 |
| PM Entries | DELETE manual PM entry -> HTTP, DB gone, page no longer lists it | PASS | [200, True] |
| PM Entries | Audit MANUAL_RECORD_DELETED written | PASS | 1 |
| Notifications | EDIT title -> HTTP | PASS | 200 |
| Notifications | DB row updated | PASS | FDM notif edit |
| Notifications | NOTIFICATIONS page (/notifications) shows it (row is for role ADMIN; SA sees per scoping) | PASS | FDM notif edit |
| Notifications | Audit MANUAL_RECORD_UPDATED written | PASS | 1 |
| Admin Requests | EDIT adminRemarks -> HTTP | PASS | 200 |
| Admin Requests | DB row updated | PASS | FDM admin edit |
| Admin Requests | ADMIN REQUESTS page (/admin-requests) shows it | PASS | FDM admin edit |
| Admin Requests | Audit MANUAL_RECORD_UPDATED written | PASS | 1 |
| Admin Requests | CREATE manual admin request -> HTTP + id | PASS | [200, "{'id': 'f39c6012-edfd-471a-8e85-867cdd0dcb9a', 'requestType': 'CREATE_USER', 'st"] |
| Admin Requests | ADMIN REQUESTS page lists it | PASS | 16 |
| Admin Requests | Audit MANUAL_RECORD_CREATED written | PASS | 1 |
| Admin Requests | DELETE manual admin request -> HTTP, DB gone, page no longer lists it | PASS | [200, True] |
| Admin Requests | Audit MANUAL_RECORD_DELETED written | PASS | 1 |
| Block Changes | CREATE manual block-change request -> HTTP + id | PASS | [200, "{'id': '97b44895-6c97-4a5d-92c8-4033d75bf667', 'filterId': 'f7f0d005-383f-48b8-8"] |
| Block Changes | DB row exists (manual_entry) | PASS | PENDING\|FDM block change |
| Block Changes | BLOCK CHANGE page (/block-change-requests) lists it | PASS | 1 |
| Block Changes | Audit MANUAL_RECORD_CREATED written | PASS | 1 |
| Block Changes | EDIT status->APPROVED; DB + page filter status=APPROVED shows it | PASS | [200, 'FDM approved'] |
| Block Changes | Audit MANUAL_RECORD_UPDATED written | PASS | 1 |
| Block Changes | DELETE -> HTTP, DB gone | PASS | [200, True] |
| Block Changes | Audit MANUAL_RECORD_DELETED written | PASS | 1 |
| Retirements | CREATE retirement of live filter test2 -> HTTP | PASS | [200, "{'success': True}"] |
| Retirements | DB: status Retired, inactive, parent cleared, lifecycle RETIRED | PASS | Retired\|false\|NULL\|RETIRED |
| Retirements | RETIREMENT LIST page (/filters/retirements) lists it with remarks | PASS | {'name': 'test2', 'remarks': 'FDM manual retirement', 'retiredAt': '2026-08-15T10:00:00.000Z', 'retiredBy': 'superadmin'} |
| Retirements | FILTERS page (/hierarchy/filters?ahuId) no longer lists it | PASS | 1 |
| Retirements | Audit FILTER_RETIRED + MANUAL_RECORD_CREATED written | PASS | [1, 1] |
| Retirements | Audit MANUAL_RECORD_UPDATED written | PASS | 1 |
| Retirements | UNRETIRE -> DB Active + parent restored + relationships; Filters page lists it again; retirement list drops it | PASS | [200, 'Active\|true\|f3fe9b7b-dbc2-4c19-b30c-69500980d562\|2', True, False] |
| Retirements | DELETE a retired filter WITH history -> refused 409 HAS_HISTORY | PASS | [409, {'cycles': 10, 'events': 67, 'identifiers': 1, 'children': 0}] |
| Retirements | DELETE a retired filter WITHOUT history (test1) -> HTTP, row gone, list drops it, FILTER_RETIRED audit kept | PASS | [200, True, 1] |
| Retirements | Audit MANUAL_RECORD_DELETED written | PASS | 1 |
| Replacements | audit chain state BEFORE (clone of live) | INFO | {} |
| Replacements | CREATE replacement record -> HTTP + FILTER_REPLACED audit row added | PASS | [200, 'd70fbdc0'] |
| Replacements | REPLACEMENT LIST page (/filters/replacements) lists it with remarks | PASS | {'oldFilterName': 'L9/AHU-91/SB/00-05', 'newFilterName': 'L9/AHU-91/SB/00-06', 'remarks': 'FDM manual replacement'} |
| Replacements | chain after CREATE (a create is chain-linked; should equal BEFORE) | PASS | None |
| Replacements | EDIT replacement remarks -> HTTP chainBroken flag; DB + list show new remarks | PASS | [200, True, 'FDM replacement EDITED'] |
| Replacements | AUDIT_RECORD_UPDATED meta-row written | PASS | 1 |
| Replacements | chain after EDIT (documented: an in-place edit breaks it) | INFO | None |
| Replacements | DELETE replacement -> HTTP chainBroken; audit row physically gone; list drops it | PASS | [200, True] |
| Replacements | AUDIT_RECORD_DELETED meta-row written | PASS | 1 |
| Audit Trail | EDIT checksum field is refused | PASS | [400, "{'error': 'NO_CHANGES', 'message': 'No editable fields were supplied.'}"] |
| Audit Trail | chain after REDACT (redact is chain-preserving) | INFO | None |
| Audit Trail | DELETE audit row permanently -> HTTP; DB gone; page 404 | PASS | [200, True, 404] |
| Audit Trail | AUDIT_RECORD_DELETED meta-row written | PASS | 1 |
| Audit Trail | chain after DELETE (documented: hard delete breaks it, stays loud) | INFO | {} |
| Guard rails | Write without _changeReason is refused | PASS | [400, '{\'error\': \'VALIDATION_ERROR\', \'message\': "body must have required property \'_cha'] |
| Guard rails | Reason shorter than 5 chars is refused | PASS | [400, "{'error': 'VALIDATION_ERROR', 'message': 'body/_changeReason must NOT have fewer"] |
| Guard rails | OPERATOR cannot read the console (403) | PASS | 403 |
| Notifications | CREATE with a valid enum type (SYSTEM_ERROR) -> HTTP + id | PASS | [200, "{'id': '4a30b2ad-e671-4589-9f37-cb1b8e3f6ba5', 'type': 'SYSTEM_ERROR',"] |
| Notifications | NOTIFICATIONS page / bell lists it for SUPER_ADMIN | PASS | 1358 |
| Notifications | Audit MANUAL_RECORD_CREATED written | PASS | 1 |
| Notifications | DELETE -> HTTP, DB gone, page drops it | PASS | 200 |
| Notifications | Audit MANUAL_RECORD_DELETED written | PASS | 1 |
| Retirements | EDIT retired record (earlier run): DB name + filterSet persisted | PASS | test2-fdm\|SET_B\|Active |
| Audit Trail | EDIT signatureMeaning -> HTTP; DB + detail page show it | PASS | [200, 'FDM edited meaning', "{'success': True, 'chainBroken': True}"] |
| Audit Trail | AUDIT_RECORD_UPDATED meta-row written | PASS | 1 |
| Audit Trail | edit of a non-editable field (userAgent) was refused NO_CHANGES (earlier run) | PASS | by design |
| Audit Trail | EDIT of an AUDIT_RECORD_UPDATED meta-row is refused 409 META_AUDIT_IMMUTABLE | PASS | [409, "{'error': 'META_AUDIT_IMMUTABLE', 'message': 'This row recor"] |
| Audit Trail | REDACT (earlier run): detail carries redactedAt / redactedBy / redactionReason | PASS | {'redactedAt': '2026-09-04T10:53:09.310Z', 'redactedByName': 'superadmin', 'redactionReason': 'FDM redact check'} |
| Audit Trail | redacted row: before/after values cleared | PASS | {'beforeValue': False, 'afterValue': False} |
| Audit chain | clone verify-chain (after all console writes) | INFO | {'intact': False, 'totalRowsChecked': 19522, 'chainedRows': 191, 'highestPosition': 193, 'anomalies': 100, 'kinds': ['PER_ROW_CHECKSUM_MISMA |
| Tab lists | Retirements: /api/filters/retirements | PASS | [200, 'rows 155', 'total None'] |
| Tab lists | Replacements: /api/filters/replacements | PASS | [200, 'rows 137', 'total None'] |
| Tab lists | Cleaning Cycles: /api/filters/cycles?page=1&limit=20&status=COMPLETED | PASS | [200, 'rows 20', 'total 597'] |
| Tab lists | Cleaning Cycles (date range): /api/filters/cycles?page=1&limit=20&from=2026-06-01T | PASS | [200, 'rows 20', 'total 130'] |
| Tab lists | Filter Events: /api/filters/events?page=1&limit=20&eventType=STATE_ | PASS | [200, 'rows 20', 'total 3398'] |
| Tab lists | PM Entries: /api/super-admin/data/pm-entries?page=1&limit=20&app | PASS | [200, 'rows 20', 'total 21'] |
| Tab lists | PM Entries (date range): /api/super-admin/data/pm-entries?page=1&limit=20&fro | PASS | [200, 'rows 20', 'total 86'] |
| Tab lists | Audit Trail: /api/audit?page=1&limit=20&search=LOGIN | PASS | [200, 'rows 20', 'total 4147'] |
| Tab lists | Notifications: /api/super-admin/data/notifications?page=1&limit=20& | PASS | [200, 'rows 20', 'total 118'] |
| Tab lists | Admin Requests: /api/admin-requests?status=PENDING | PASS | [200, 'rows 2', 'total None'] |
| Tab lists | Block Changes: /api/block-change-requests?page=1&limit=20&status=AL | PASS | [200, 'rows 0', 'total 0'] |
| Tab lists | Console users picker: /api/users?page=1&limit=1000000 | PASS | [200, 'rows 9', 'total 9'] |
| Tab lists | Console profiles picker: /api/filter-cleaning-profiles?limit=1000000 | PASS | [200, 'rows 8', 'total 8'] |
| Tab lists | Console PM schedule picker: /api/super-admin/data/pm-schedules | PASS | [200, 'rows 15', 'total None'] |
| Tab lists | Console filters picker: /api/hierarchy/filters | PASS | [200, 'rows 199', 'total 199'] |
| Notifications | CREATE / EDIT with an invalid enum value -> clean 400 INVALID_VALUE naming the allowed values (FIXED this session; re-probed on the clone API) | PASS | 400 INVALID_VALUE for notification type, cycle status, PM approvalStatus; valid values still 200 |

## Things worth knowing (INFO rows)

- **Editing a cycle's status does not reconcile `FilterDetails.currentLifecycleState`** - documented gap of the 2026-08-27 retrofit, re-confirmed: setting a COMPLETED cycle to TERMINATED left the filter's lifecycle state untouched.
- **Audit chain.** The live DB's chain was already `intact: false` before this work (100 PER_ROW_CHECKSUM_MISMATCH anomalies reported, 191 chained rows - see memory `reference_audit_chain_state`). On the clone, a replacement CREATE is chain-linked; replacement EDIT / DELETE and audit-row EDIT / permanent DELETE return `chainBroken: true` and write their `AUDIT_RECORD_UPDATED` / `_DELETED` meta-rows, exactly as documented. Redact is chain-preserving and clears before/after values.
- A retired filter WITH history (10 cycles, 67 events, 1 tag) is refused deletion with `409 HAS_HISTORY` listing the blockers; one WITHOUT history deletes and keeps its `FILTER_RETIRED` audit row.
- Notification rows scoped to another role (`forRole: ADMIN`) still appear for SUPER_ADMIN on the Notifications page in this deployment.
- Guard rails hold: no `_changeReason` -> 400, reason under 5 chars -> 400, OPERATOR -> 403 on every console endpoint.
