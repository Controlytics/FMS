# Step 5b — Path A: Universal versioning for mutable checklist definitions

**Goal:** make online and offline checklist submissions identically reproducible by versioning every mutable definition. Operators always answer against a specific version; cycles pin versions at start; audit replay is byte-exact regardless of subsequent edits.

## Phase A.1 — ChecklistProfile versioning (this PR)

**In scope:** ChecklistProfile + ChecklistQuestion. Mirrors the existing AssetTemplate/AssetTemplateVersion pattern.

### Schema

```prisma
model ChecklistProfile {
  id          String   @id
  version     Int      @default(1)            // current live version pointer
  // ... existing fields stay
  versions    ChecklistProfileVersion[]
}

model ChecklistProfileVersion {
  id            String   @id
  profileId     String
  versionNumber Int
  snapshot      Json    // { name, description, isActive, questions: [...] }
  changeNotes   String?
  createdAt     DateTime @default(now())
  createdBy     String?

  profile ChecklistProfile @relation(fields: [profileId], references: [id], onDelete: Cascade)

  @@unique([profileId, versionNumber])
  @@index([profileId])
  @@map("checklist_profile_versions")
}
```

### Cycle pinning

```prisma
model CleaningCycle {
  // ... existing fields
  checklistVersionPins Json @default("{}") @map("checklist_version_pins") @db.JsonB
  //   shape: { [checklistProfileId]: versionNumber }
}
```

At cycle start, walk the pipeline graph, collect every `checklistProfileId` referenced by CHECKLIST nodes, and snapshot each profile's current version into `checklistVersionPins`. From then on, getCurrentState/submitChecklist resolve questions through the pinned version — even if the profile is edited mid-cycle.

### Edit semantics — snapshot-then-bump

Every `checklist-profile.service.ts` write path:

```ts
// inside a transaction
const before = await tx.checklistProfile.findUnique({
  where: { id }, include: { questions: { orderBy: { sortOrder: 'asc' } } }
});
await tx.checklistProfileVersion.create({
  data: {
    profileId: id,
    versionNumber: before.version,                 // freeze the *outgoing* version
    snapshot: { name, description, isActive, questions },
    changeNotes,
    createdBy: ctx.userSub,
  }
});
await tx.checklistProfile.update({
  where: { id },
  data: { ...changes, version: { increment: 1 } }
});
```

Affects: `update`, `delete` (snapshot-then-soft-delete), `addQuestion`, `updateQuestion`, `deleteQuestion`, `reorderQuestions`.

### Read semantics

- **Live editor** (`/checklist-admin/list`, `/checklist-admin/detail`) — reads live profile + live questions. Unchanged.
- **In-cycle resolution** (`getCurrentState`, `submitChecklist`) — reads pinned version from `ChecklistProfileVersion.snapshot` keyed by `(cycle.checklistVersionPins[profileId], profileId)`. Falls back to live if profile isn't pinned (cycles that started before this PR).
- **Audit replay** (cycle-history-by-id reader at filter-operations.service.ts ~1382) — same; resolves questions from the version snapshot the cycle pinned.

### Offline sync contract

- `GET /api/checklist-profiles/:id/versions/:versionNumber` — fetch a specific historical version. Cacheable forever (immutable).
- `GET /api/checklist-profiles?expand=questions` — returns live profile + version field. Tablet caches.
- `GET /api/filters/:id/current-state` — response includes the cycle's `checklistVersionPins` map. Tablet uses it to know which version to render and submit.
- `POST /api/filters/:id/submit-checklist` — body adds `expectedProfileVersions: { [profileId]: number }`. Server validates against the cycle's pinned map, NOT against live profile state.

### Migration / backfill

For every existing ChecklistProfile, create a `ChecklistProfileVersion` row with `versionNumber: 1` and snapshot = current state. Existing in-progress cycles get `checklistVersionPins: {}` (legacy fallback to live questions until they complete).

### Submit contract under versioning

```
client → POST /api/filters/:id/submit-checklist
{
  answers: { [questionId]: value },
  expectedProfileVersions: { [profileId]: versionNumber },  // what client cached
  clientOpId: "...",
  offlinePerformedAt: "...",
}
```

Server flow:
1. Resolve cycle, current stage, pinned versions (from cycle.checklistVersionPins).
2. For each profile referenced at this stage:
   - If `expectedProfileVersions[profileId]` !== `cycle.checklistVersionPins[profileId]` → 409 SCHEMA_DRIFT with diff.
3. Resolve questions from each pinned version's snapshot.
4. Validate answers (required filled, no extras).
5. Persist `CHECKLIST_COMPLETED` FilterEvent with snapshot + answers + clientOpId + offlinePerformedAt.

## Phases A.2-A.4 — Other versionable entities (separate PRs)

- **A.2** — `FilterCleaningProfile` already has `version` + `status DRAFT/ACTIVE/ARCHIVED`. Half-versioned. Add `FilterCleaningProfileVersion` immutable table; cycles already pin `profileVersion`.
- **A.3** — `FilterProfile` (mapping). Per-block override capability needed for Step 7.
- **A.4** — Cleaning reasons (config def), equipment-group instruments. Lower priority.

Not in this PR.

## Acceptance gates for A.1

- `prisma validate` clean; `tsc --noEmit` (api+web) exit 0
- `prisma db push` succeeds; existing data backfilled to v1
- Editor mutations create version rows + bump version
- Cycle start writes `checklistVersionPins`
- `getCurrentState` resolves from pins
- `submitChecklist` honors pinned versions for drift detection
- 409 SCHEMA_DRIFT round-trip works (rename a question between cycle start and submit; submit returns drift; client re-fetch + re-answer succeeds)
- Cycle history audit replay shows pinned-version questions, not live questions
- UI walk: edit a checklist profile, verify version increments, verify cycle started before edit still uses old questions
