# Audit hash chain - investigation (2026-09-04)

`GET /api/audit/verify-chain` on the live dev DB reported `intact: false` with
3,416 anomalies, of which 3,310 were `PER_ROW_CHECKSUM_MISMATCH` ("in-place
tampering detected"). The 2026-07-15 note called 3,308 of them UNEXPLAINED.
They are explained now, and proven.

## The 3,308 May rows: a formula artefact, not tampering

- **Where.** All between 2026-05-11 and 2026-05-29, about half of every day's
  rows, every action type, every writer (browser 1166/2144, tablet 621/2141,
  test suite 1230/1624, curl 291/348) - and a hard stop on 05-30.
- **The tell.** Rows whose `after_value` has 0 or 1 keys: **0 of 2,076** bad.
  Rows with 2 or more keys: almost all bad (2 keys: 1707/2004; 4 keys: 220/227;
  13 keys: 14/14; 28 keys: 137/137).
- **Why.** Until commit `9014b4c` (2026-05-29) the writer hashed the V1 form:
  top-level keys sorted, nested objects in INSERTION order. Postgres JSONB
  re-orders object keys on storage (by length, then bytes). So a payload the
  code wrote as `{ username, fullName }` is stored and read back as
  `{ fullName, username }`, and the V1 hash can never be rebuilt from the DB.
  The 05-29 V2 canonical form sorts keys at every level, so nothing written
  after the cut-over is affected.
- **Proof.** Two real rows (genesis position 1, chained position 330): with the
  keys restored to the order the code wrote them, the V1 formula reproduces the
  stored checksum byte for byte. Every other variant (field sets, timestamp
  formats, V2, the JSONB order) fails. Locked in
  `lib/__tests__/audit-verify-legacy-key-order.test.ts` with the genesis row.

## The rest, all accounted for

| Kind | Count | Cause |
|---|---|---|
| CHAIN_LINK_MISMATCH | 44 | the deliberate AUDIT_DELETE / hard-delete tests of 2026-05..08 (a deletion breaks the next row's link by design) |
| CHAIN_POSITION_GAP | 62 | the same deletions (contiguous ones merge into one gap) |
| PER_ROW_CHECKSUM_MISMATCH | 3 | position 18444 and 18484: edited in place on 2026-08-27 via `PUT /api/audit/:id`, each with its `AUDIT_RECORD_UPDATED` meta row. Position 2768: a `FILTER_REPLACED` row whose timestamp reads 2026-05-11 05:00:00 while its neighbours (2767, 2769) are 2026-05-20 15:58 - rewritten through the replacement-record edit, which was silent until the 2026-08-27 retrofit made it write a meta row. A real in-place edit; the verifier is right to keep it. |

The live write path is clean: nothing dated after 2026-05-29 mismatches except
the two 08-27 edits, and today's work (M27 clean-up, console verification on a
clone, the four Low fixes) added no anomaly.

## What changed

- `verifyAuditChain` now classifies a failed per-row check on a pre-cut-over,
  unkeyed row whose payload has 2+ keys: it tries every key order (payloads up
  to 6 keys, 720 hashes) and reports `LEGACY_V1_KEY_ORDER` (proven) or, for
  larger payloads, `LEGACY_V1_KEY_ORDER_UNVERIFIABLE`. Both are informational:
  counted in `legacyKeyOrderRows`, listed, but not tampering and not counted
  against `intact`. A small payload that matches under NO order stays
  `PER_ROW_CHECKSUM_MISMATCH` - a real edit is still a real edit. Rows written
  after the cut-over, and keyed (v3) rows, are never reclassified.
- The 100-anomaly default cap is gone: the walk covers the whole chain unless
  the caller passes `maxAnomalies`. The old default made the endpoint stop at
  position ~193 and report a precise-looking number that was a cap.
- Nothing was recomputed or rewritten. Historical checksums stay as written.

Live result after the change: 19,534 rows; legacy 2,376 proven + 931
unverifiable; 44 + 62 deletion artefacts; 3 real per-row mismatches;
`intact: false` (correctly - the deletions and the three edits are real).

## What this means for a customer install

A customer DB starts after the V2 cut-over and never runs the hard-delete
tests, so none of this residue exists there; `intact` should read `true` from
day one and any anomaly is a finding. The 931 unverifiable rows here mean their
FIELDS cannot be tamper-checked; their chain LINKS still are, so deletions and
insertions around them remain detectable.
