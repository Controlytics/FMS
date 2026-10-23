# 08 — Coverage and test quality

Branch `RFID`. Every number below is **EXECUTED 2026-10-23** unless marked otherwise; raw reports are in
`QA/coverage/final-2026-10-23/` (git-ignored: `api/`, `web/`, `shared/` = istanbul json + summary;
`mutation/` = Stryker json + html; `*-run*.txt` = the run logs).

Operator target (2026-10-21): **≥ 90 % lines, statements, branches and functions, API and Web measured
separately**, no gaming (no excluding difficult code, no weakened or deleted tests, no meaningless mocks),
plus mutation testing.

## 1. Results

| Package | Tests | Statements | Branches | Functions | Lines | Gate |
|---|---|---|---|---|---|---|
| API (`apps/api`, single-fork, real `digilog_test_db`) | 342 files · 4,441 passed · 15 skipped · 6 failed¹ | **97.52 %** | **94.95 %** | **99.45 %** | **97.52 %** | 90 × 4, `vitest.config.ts` (`20a5ed0`) |
| Web (`apps/web`, jsdom) | 356 files · **5,163 passed** · 0 failed | **97.59 %** | **94.42 %** | **97.00 %** | **97.59 %** | 90 × 4, `vitest.config.ts` (`0d5ec36`) |
| Shared (`packages/shared`) | 427 passed | **93.29 %** | **97.83 %** | **93.10 %** | **93.29 %** | 90 × 4, `vitest.config.ts` (`5857a9b`) |

¹ The 6 failures were all in the date-range guard and came from a **process-wide time-zone leak between
test files** (one file set `TZ` and never restored it; another restored with `delete process.env.TZ`,
which does not reset Node's zone). Chasing them exposed a **real product defect** — a bare start date was
read as UTC midnight while a bare end date was read as local end-of-day, so on the India server a filter
"from 1 Feb" silently dropped records made 00:00–05:30 IST that day. Both fixed in `d195f84` (one
`parseRangeStart` / `parseRangeEnd` pair at every query site, `pinTimeZone` helper, and `vitest.setup.ts`
now FAILS any file that leaves the zone changed) and `d7a4dc0` (web sends bare end dates). The two
earlier full runs also failed 9–11 unrelated files: Postgres ran out of connections because every test
file built its own Prisma pool and never closed it — and because two PRODUCT modules
(`admin-request.service.ts`, `email-channel.ts`) each built a second PrismaClient. Fixed in `a8dad9a`
(one pool per process; per-file `$disconnect`); peak test-DB connections dropped to 2.

**Where coverage is still low (stated, not hidden):**

| File | Lines | Branches | Note |
|---|---|---|---|
| `apps/api/src/app.ts` | 0 % | 0 % | process entry point; exercised by the boot / health integration test, not by vitest coverage |
| `apps/api/src/scripts/*.ts` (2) | 0 % | — | one-off operator scripts |
| `apps/api/.../filter-operations/events-routes.ts` | 99.5 % | 64.3 % | defensive branches of the list query builder |
| `apps/web/src/main.tsx` | 0 % | 0 % | app entry / route table |
| `apps/web/.../filter-operations.tsx` | 68.7 % | 65.4 % | **the desktop Filter Operations page** — its flows are covered by 27 + 76 page tests, but this 3,000-line component still has untested branches; the most important residual gap |
| `apps/web/.../cleaning-profile-editor.tsx` | 51.3 % | 63.4 % | canvas drag / wiring interactions |
| `apps/web/src/components/SendForReviewButton.tsx` | 38.5 % | 30.0 % | small component |

Nothing was added to any coverage `exclude` list in this campaign; the only exclusions are test files,
`.d.ts`, test helpers and the web `test-utils/` harness (all pre-existing).

## 2. Mutation testing (Stryker 9.6.1)

Run on DB-free unit tests only (`apps/api/vitest.stryker.config.ts` — no `globalSetup`, so parallel
mutants never touch a database) and on the shared package's own tests.

| Target | Mutants | Score (total) | Before this campaign |
|---|---|---|---|
| `packages/shared` — pipeline executor (every cleaning-cycle gate) | 1,336 | **88.70 %** | — (first run) |
| `apps/api` — `hash-chain.ts` | 240 | **100.00 %** | 62.1 % |
| `apps/api` — `audit-verify.ts` | 316 | **98.73 %** | 30.4 % |
| `apps/api` — `ssrf.ts` | 146 | **98.63 %** | 78.8 % |
| `apps/api` — `rbac.ts` (permission plugin) | 132 | **95.45 %** | 26.5 % |
| `apps/api` — `reauth-check.ts` (electronic signature gate) | 240 | **93.33 %** | 39.6 % |
| `apps/api` — `rate-limit-key.ts` | 78 | **85.90 %** | 71.8 % |
| **API security libraries, all** | 1,152 | **96.61 %** | 47.4 % |

The remaining API survivors were reviewed and are equivalent or unreachable (log-message strings,
IPv6-expansion guards after `isIPv6()`, a `slice()` on a list never mutated, a fallback a verdict can
never reach). The first run's survivors were real gaps, e.g. a mutant turning "invalid URL" into
"allowed" and one flipping the account-locked status code — both now killed. Commits: `880d60d`
(audit chain), `13d69b3` (signature gate / RBAC / SSRF / rate limit), `2a608fb` (first run).

## 3. Test quality — what the tests found

The coverage campaign was run defect-first: every new test had to fail against the old code before the
fix. It found **real product defects**, among them (CHANGELOG 2026-10-21 / 10-22 has the full list):

- 44 of 84 pipeline shapes could never complete (server + clients) — now a 112-case permanent matrix;
- a checklist could be answered at the wrong station; a refused tablet start counted as started; a
  mixed batch silently dropped in-cycle work; same-millisecond offline ops replayed in random order;
- redacted audit rows escaped tamper detection; the Super Admin signed almost nothing (OD-01);
- signatures were recorded for requests that were then refused (validate-before-sign, D03-09);
- CSV backups could not restore their own file; a failed restore left an unprotected audit copy;
  restoring certain archives erased live audit rows; one tag could be bound to two filters;
- the date-range time-zone defect and the second Prisma pool above.

Flaky tests were fixed at their cause (a click or assertion before the UI was ready, a shared fixture,
a time-zone leak, connection exhaustion), never by raising a timeout to hide a race. Two files whose
cost is real page work (Filter Data Management) carry a 20 s budget, measured and commented.

## 4. Not done / limits

- The API mutation run covers six security libraries, not the whole API (DB-bound code would need a
  serial, much slower Stryker set-up).
- Coverage percentages are line/branch counts; they do not prove a branch is asserted. Mutation scores
  are the stronger signal and exist only for the targets above.
- Some raw scratch logs cited by earlier deliverables were lost on 2026-10-22 (README, evidence-loss
  note); the numbers here come from the reports kept in `QA/coverage/final-2026-10-23/`.
