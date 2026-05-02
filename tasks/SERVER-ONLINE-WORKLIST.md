# Server / online-side worklist (post-audit, 2026-05-02)

Per user direction: work only on server-side / online issues. Tablet/APK/offline items deferred — see `future/offline-version-sync-contract.md` § "Addendum".

Each item below has been audited against live code (line-number evidence). Items are ranked by user impact + cost.

## Items

### L1 — `getCurrentState()` returns pinned EquipmentGroupVersion snapshot (HIGH PRIORITY)

**What:** Today `filter-operations.service.ts:488` returns `prisma.equipmentGroup.findUnique` (the **live** group). When `cycle.equipmentGroupVersionPin` is set, it should return the snapshot from `EquipmentGroupVersion(groupId, versionNumber=pin)` instead.

**Why:** Closes the operator-visible drift surface from P1 — today the FE renders dropdowns from live operating ranges (`mobile-operations.tsx:2062` calls `genOpts(inst.operatingMin, inst.operatingMax, inst.leastCount)`), but server validation reads from the pinned snapshot inside `advance()`. Operator can pick a value the server rejects with no warning. After L1, the dropdown automatically picks up pinned ranges and the operator sees what they're held to.

**This also implicitly closes the offline reading-submit replay drift** — once the tablet caches the pinned snapshot per-cycle, subsequent admin edits to the live group don't reach the tablet's cache. Slice B's primary motivation evaporates.

**Touchpoints:**
- `apps/api/src/modules/filter-operations/filter-operations.service.ts:486-511` (the `equipmentGroup` resolution block in `getCurrentState`).
- Lazy first-version handling: when pin is set but no `EquipmentGroupVersion` row exists yet (live row IS v1), fall through to live row IFF `live.version === pin`. Mirrors the validation-time logic at `:1101`.
- Legacy fallback: when `pin === null` (cycles started before P1), keep returning the live row.
- The `blockEquipmentGroups` array (line 506-510) — used when no specific group is bound to the cycle. Stays as live data; no cycle to pin against yet.

**Test plan:**
- Seed a cycle with `equipmentGroupVersionPin = 1`, edit the group to v2, GET `/current-state`, assert response carries v1 ranges (not v2).
- Set `equipmentGroupVersionPin = NULL`, GET `/current-state`, assert response carries live group (legacy fallback).
- Set `equipmentGroupVersionPin = 99` (nonexistent snapshot) on a v1 live row, assert the lazy first-version fallback fires correctly.

**Effort:** ~half day including curl tests + doc sync. **Tablet/APK touch: NONE.** The APK consumes the same `{operatingMin, operatingMax, leastCount, uom, id}` field shape from the snapshot as it does from the live row — no rebuild required.

---

### L2 — Same pinned-snapshot read for the `getCurrentState()` `cleaningProfileGraph` field (MEDIUM PRIORITY)

**What:** `getCurrentState()` returns `pipelineGraph` and `pipelineStages` derived from `getProfilePipeline(resolvedProfileId, false)` (line 403). `resolvedProfileId` is sourced from `resolveFilterProfile(filter)` — the live filter profile binding, not the cycle's pinned `profileId`.

**Effect:** Operator's UI shows the live cleaning-pipeline graph for the cycle's filter, not the graph the cycle was actually started against. This is currently mitigated by `profileSyncWarning` (line 553-577) which detects mismatch and recommends `TERMINATE_AND_RESTART`, but the actual rendered pipeline is still the live one. Operator sees a stage layout that doesn't match the cycle's pin.

**Touchpoint:** `filter-operations.service.ts:403` — call `getProfilePipeline(currentCycle.profileId, false)` instead when `currentCycle` exists (pinned), falling back to the live `resolvedProfileId` only when no cycle is active.

**Why this matters online:** if an admin updates a cleaning profile mid-cycle (creates v2, archiving v1), the cycle is correctly pinned to v1 (rowful immutability A.2), `advance()` correctly enforces v1's transitions, but the operator's tablet display shows v2's stage layout. Visual mismatch with no functional consequence — `advance()` still rejects bad transitions — but operator confusion.

**Effort:** ~half day. Server-only.

---

### L3 — `profileSyncWarning` should also surface for in-flight `EquipmentGroupVersion` divergence (LOW PRIORITY)

**What:** `profileSyncWarning` (line 553-577) detects FilterCleaningProfile drift against the cycle's pin. There's no equivalent for EquipmentGroup. After L1 lands, the tablet sees pinned ranges in the UI; after admin edits, the operator has no signal that the rules they're working under aren't the latest.

**Why low priority:** L1 alone delivers correct enforcement. This is purely advisory ("admin updated the equipment group; you're still on v1") — useful for transparency but not for correctness.

**Touchpoint:** `filter-operations.service.ts:553-577` — extend the warning block to also compare `cycle.equipmentGroupVersionPin` against the live group's version, emit a sibling warning if they differ.

**Effort:** ~2 hours. Server-only.

---

### L4 — Audit `advance()`'s reading-validation lazy-first-version path (LOW PRIORITY)

**What:** `advance()` at line 1101+ reads `EquipmentGroupVersion.findUnique` for the cycle's pin. If the row doesn't exist (lazy first-version), it falls back to live row + asserts `live.version === pin`. Concern: `instruments[].id` differs between snapshot.instruments (snapshot json) and live `equipmentGroupInstrument` rows. Field shape is the same but the snapshot stores the instrument's row ID at the time of snapshot — if admin replaces an instrument between cycle start and this read, the live instrument list could have new IDs. The `inst.id` referenced in submitted `instrumentReadings` is the operator's tablet-cached id; if it doesn't match the snapshot's id, the lookup `instrumentReadings[inst.id]` fails.

**Real-world likelihood:** very low — admin would have to fully replace an instrument (delete + create new) mid-cycle. Hard to do via the existing `equipment-groups.service.ts` `update()` path because it only mutates fields, not row identity.

**Touchpoint:** `filter-operations.service.ts:1101-1175`. Defense-in-depth review of the snapshot-vs-live equality assertion.

**Effort:** ~1 hour read + 1 hour test. Server-only.

---

### L5 — Browser smoke test of the new Version History page on a live cycle (NICE-TO-HAVE)

**What:** Build, tsc, and unit tests are clean. Never opened the page in a browser with seeded data. Covers visual layout, sidebar render gating, deep-link query parameter behavior, snapshot modal scrolling.

**Effort:** ~30 min once data is seeded.

**Touchpoint:** none (verification only).

---

### L6 — `apps/web` Vitest setup (DEPRIORITIZED)

**What:** No FE test config exists. Diff engine in `version-history/index.tsx` has zero coverage.

**Effort:** ~half day to bootstrap.

**Why deprioritized:** Not blocking any user-facing issue; reasonable to skip until a regression demands it.

---

## Order of execution (recommended)

1. **L1** — fixes the only actively biting online drift; ~half day; no APK touch.
2. **L2** — fixes pipeline-graph display drift; same touchpoint area as L1.
3. **L5** — quick browser smoke once L1+L2 land.
4. **L3** — UX polish; can ship anytime.
5. **L4** — defense-in-depth review.
6. **L6** — only when needed.

## What NOT to start (per user direction)

- O1-O5 from `future/offline-version-sync-contract.md` § "Addendum" — all tablet/APK-related.
- Slice B as a whole — tablet contract change.
- Step 8 / Step 9 — APK rebuild + tablet rewrite.

---

Recorded 2026-05-02. Read this with `future/offline-version-sync-contract.md` § "Addendum" — together they partition the work cleanly into "server / online" (this doc) vs "tablet / offline" (the addendum).
