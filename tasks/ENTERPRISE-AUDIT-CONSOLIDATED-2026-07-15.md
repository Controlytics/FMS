# DigiLog — Enterprise Audit, Consolidated Report (as of 2026-07-15)

**Supersedes** the two separate datasets that existed until now:
- `ENTERPRISE-AUDIT-REPORT.md` — 535 findings, hand-assembled 2026-07-13 (the synthesis agent died on a session limit)
- `SECURITY-PHASE-REPORT.md` — 53 findings, the re-run security phase, 2026-07-13

Both lived only in a **temp scratchpad** (`AppData/Local/Temp/claude/.../d4e93b4a-.../scratchpad/audit/`),
which is not durable. This file is the versioned successor. The raw datasets
(`findings-dataset.json`, `security-findings.json`) remain there; copy them out if
they still matter.

Per-finding evidence and the decision record: `ENTERPRISE-AUDIT-HIGHS-TRIAGE-2026-07-15.md`.

---

## 1. Where it stands

| Severity | Found | Verified | Fixed | Open |
|---|---|---|---|---|
| **Critical** | 3 | 3 | **3** | 0 |
| **High** | 38 | 38 | **35** | 0 (3 vetoed as authorized design) |
| **Medium (high-signal)** | 62 | 62 | **54** | 0 (2 already fixed, 3 by-design, 3 refuted) |
| **Medium (low-signal)** | ~96 | in triage | — | in triage |
| **Low** | 248 | in triage | — | in triage |
| **Info** | 89 | 0 | — | not triaged (informational) |
| **Dependencies** | 17 prod advisories | 17 | **13** | 4 (unreachable, no in-range fix) |

Suites: **apps/api 1083 / 0 / 12** (102 files) · **apps/web 464 / 0** (35 files) · shared 332.
~40 tests added, several mutation-verified.

**Everything actionable at Critical/High/high-signal-Medium is closed.** What remains is
either a user data decision, physical tablet verification, or the low-signal tail.

---

## 2. The finding that outlives the findings

**Both Medium verifiers, working independently, reached the same conclusion: the
2026-07-13..07-15 fixes hit the *symptom* and left the *sibling surfaces*.**

| Fixed | Sibling left broken |
|---|---|
| Backup **restore** (triggers, sequences, password hashes) | its CSV parser, truncation check, truncate-coverage, export snapshot isolation |
| Audit-payload masking (`lib/mask-secrets.ts`) | `GET /sms` still returned the same secrets unmasked |
| `assertCanManageTarget` on all user **mutations** | `getById` — a USER_READ holder could still read a SUPER_ADMIN |
| audit `targetId` overflow on bulk ops | the delete **lookups** stayed unscoped by role |

`feedback_audit_pattern_across_codebase` already says *fix the pattern, not the symptom*.
It wasn't applied, and that is precisely why round 3 found 54 more. **When a finding names
one call site, grep for the shape before declaring it closed.**

### Three tests were actively defending bugs
Each encoded a confident, wrong justification in its own comment:
- `resetAuditSequence` — *"is a no-op: audit_trail PK is a UUID with no sequence to reset"*. The PK is a UUID; `chain_position` is a BIGSERIAL. The function had zero callers and nothing ever realigned sequences after a restore.
- `sync.routes` — *"has no preHandler — auth comes from the global onRequest hook"*. That hook authenticates; it does not authorize. A zero-permission account could pull the whole plant model.
- `verifyAuditChecksum` — *"always returns true for redacted rows… a mutation would still surface via chain mismatch on the NEXT row"*. It wouldn't: the next row's link points at this row's **stored** checksum, which an attacker never touches.

### Verification changed the answer repeatedly
- **L81** (admin-requests "second door") — REFUTED at HEAD; an earlier fix had closed it transitively.
- **L41** — symptom real (blank dropdown), stated mechanism wrong (RHF submits from `_formValues`, not the DOM).
- **L131** — "SUPER_ADMIN takeover" refuted; three guards cap it at ADMIN.
- **Mass assignment ×2** — claimed AJV lacks `removeAdditional`. It has it; it only acts when the schema declares `additionalProperties: false`.
- **`AuditAction` typing** — the proposed fix would have broken 65 working call sites. `AUDIT_ACTIONS` (89) isn't the registry; `AUDIT_TEMPLATES` (127) is. Zero production actions lack a template.
- **`sanitize-html`** — real advisory, not exploitable here (`allowedTags: []`).
- **`@fastify/static`** — recorded as unfixable; needed one `npm update`.

---

## 3. The one nobody was looking for

**Backup restore had been 100% broken since 2026-07-04 — and the commit that broke it was
itself a "CRITICAL restore lockout" fix.**

`ae1bc3b` added a pre-truncate snapshot selecting `users.password_history_hashes` — a column
that has never existed (password history is its own table). It raised `42703` on every
restore, and **a caught JS error does not un-abort a Postgres transaction**: everything after
died with `25P02` and the whole restore rolled back. The `try/catch` is what hid it.

It also explains why the mirror-trigger bug went unnoticed for months: nothing ever got that far.

**Only running a restore could find this.** Typecheck, unit tests and code review all pass
on it. Proven fixed by a real round-trip into a throwaway DB: counts exact, chain state
byte-identical to source, sequences non-colliding, and real password hashes preserved —
meaning the 07-04 lockout fix works for the first time.

---

## 4. Deliberately NOT fixed (authorized design)

Confirmed as real code behaviour, left alone by explicit operator decision:

1. **super-admin can rewrite checksummed `audit_trail` fields** — the manual-record-edit feature; the §11 warning was overridden twice.
2. **Reauth on Filter Data mutations ships OFF** — intentional configurable default. (The real bug inside it — `SUPER_ADMIN_DATA_EDIT` being *unsettable* in the UI — was fixed.)
3. **`audit_trail` has no UPDATE immutability trigger** — the trail is tamper-**evident** (hash chain detects edits), not tamper-**proof**. Documented 2026-07-10.
4. **The sync global-max version cursor** — offline-sync is a protected surface; its own task, not a sweep.

---

## 5. Open — operator actions

| # | Item | Impact |
|---|---|---|
| 1 | **Block MUPS has 2 active equipment groups** ("Testing", "Testing 2") | **Live**: operators there get `MULTIPLE_EQUIPMENT_GROUPS` on readings; unpinned cycles resolve zero instruments. Also blocks the partial unique index that would properly close the equipment-group race (the in-tx count only narrows it — READ COMMITTED lets two txs both count 0). Fix via UI so it's audited. |
| 2 | **Filter `CWH/F1/AHU-0B/SA/05/06-01`** is Set A, should be Set B | Corrupted 2026-07-14 by the Edit-dialog enum bug (live since 04-20). 91 earlier edits are forensically invisible — before/after audit capture only landed 07-08. Fix via UI so the correction is audited. |
| 3 | **Static IP `192.168.1.55`** + tablet Server Address `https://192.168.1.55:3000` | Machine drifted to `.124`, which the cert doesn't cover. `.55` is already in the cert SANs — no regen, no root-CA reinstall. APK is built and baked for it. |
| 4 | **Tablet verification** | Bulk filter-operate (pending since 07-09) and the new `sync/since` authz gate (protected surface). |
| 5 | **`/docs` under `@fastify/static@9.3.0`** | Unverified — no test covers it, and the running API holds pre-update modules. One restart settles it. Deferred because live users were on the API. |

---

## 6. Open — known gaps, with reasons

- **3,408 audit-chain anomalies** in `digilog_db`. `verify-chain` under-reports: `maxAnomalies` defaults to 100, so it bails at position ~193 and never checks the other ~16,700 rows. The **live write path is clean** (positions ≥16000: zero anomalies) and June is spotless; the damage is a ~49% cluster in May 2026 that the known AUDIT_DELETE test artifacts (41 link breaks + 59 gaps) do **not** explain. **Deliberately not "fixed"** — recomputing historic checksums to make verification pass is indistinguishable from tampering, and this design keeps breakage loud. See `reference_audit_chain_state_2026_07_15`.
- **4 dependency advisories remain** (`tar`, `uuid`) — neither reachable, neither fixable in-range. ⚠ **Do not run `npm audit fix --force`**: npm's "fix" for uuid is a **major downgrade of exceljs 4.4.0 → 3.4.0**, which would partially undo the 07-13 xlsx CVE migration.
- **LDAP audit unverified** — no directory available; covered by unit tests only.
- **`AuditEntry.action` is typed `string`** — investigated; the obvious fix is wrong (see §2). Typing against TEMPLATE keys would be the correct form, but there is no live defect behind it.
- **~96 low-signal Mediums + 248 Lows + 89 Info** — triage in flight / not started.

---

## 7. Method notes (worth reusing)

- **Refute-by-default verification, with the fix history supplied.** Roughly 20% of findings were stale or had the right symptom with the wrong mechanism. Agents that were told "some are already fixed, some are wrong" caught them; a fix-the-list approach would have shipped all of them.
- **Test the runtime, don't reason from docs.** The wins came from running the repo's actual libraries: RHF in jsdom, Prisma's generated SQL captured, the AJV question settled by booting a real Fastify, the sanitize-html PoC executed against our config.
- **Mutation-test the test.** A first-draft password test *passed against the broken implementation*. Measuring the real distribution (35.0% vs 27.2% uniform) produced a threshold that discriminates. Every statistical or atomicity test added afterwards was checked by reverting the fix and confirming it goes red.
- **Check the data, not just the code.** L71 was reported "latent — only fires where block-direct AHUs exist". The database has 7 of 38, carrying 35 filters. The report had been silently under-reporting for months.
