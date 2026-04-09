# Filter Operations — Per-Stage Screen Refactor

## Goal
Replace inline dialog-based stage flow in `filter-operations.tsx` with a dedicated screen per stage. User clicks a stage card on the main ops page → routes to a new screen where scanning, batching, dialogs (reason/duration/equipment/checklist) and submission happen.

## Current behavior
- `filter-operations.tsx` is one page. Clicking a stage sets `activeStage` and opens `StageScanDialog` modal over the same page. All dialogs/state live in one giant component.

## Target behavior
- Ops page = stage cards + block selector + recent submissions. Clicking a stage navigates to `/filter-management/operations/:stageKey`.
- Stage screen handles: scan queue, batch submit, all required dialogs for that stage.
- On submit success: toast, stay on screen (keep scanning more filters at the same stage) until user hits back.

## Plan

### 1. Route + skeleton
- [ ] Add route `/filter-management/operations/:stageKey` in router.
- [ ] Create `apps/web/src/routes/filter-management/stage-operation.tsx`.
- [ ] Guard invalid `stageKey` → redirect to ops landing.

### 2. Extract shared logic
- [ ] Create `apps/web/src/routes/filter-management/hooks/use-stage-operation.ts`:
  - scanQueue state + add/remove
  - submit (mirrors current `handleSubmitBatch` + `advanceBatch`)
  - dialog orchestration (reason → duration → equipment → checklist)
  - returns `{ scanQueue, addScan, removeScan, submit, dialogs, loading, error, toast }`

### 3. Stage screen UI
- [ ] Header: stage label, back button, block selector.
- [ ] Scan input (`data-rfid="true"`) + RFID guard.
- [ ] Queue list with remove.
- [ ] Submit button → hook's `submit`.
- [ ] Render existing dialog components driven by hook state.
- [ ] Toast + `ErrorPopup`.
- [ ] After submit success: clear queue, show toast, stay on screen.

### 4. Refactor landing page
- [ ] `filter-operations.tsx` becomes thin:
  - Stage grid → each card is `<Link to={...}>`.
  - Recent submissions list (persist via sessionStorage).
  - Keep "Status" mode tab.
- [ ] Delete inline scan/dialog state from this component.

### 5. Recent submissions persistence
- [ ] Move `recentSubmissions` to sessionStorage (`filter-ops-recent`) so it survives navigation.

### 6. Mobile scope
- [ ] **Leave `mobile-operations.tsx` alone** unless user requests otherwise.

### 7. Testing matrix
- [ ] WASH_IN (first scan → reason dialog → advance)
- [ ] WASH_OUT (plain advance)
- [ ] DRY_IN entry (duration dialog)
- [ ] DRY_IN → DRY_OUT (equipment/readings dialog, half-time guard)
- [ ] STORAGE_IN / STORAGE_OUT
- [ ] Checklist-required transition
- [ ] Batch scan multiple filters
- [ ] Out-of-sequence error

### 8. Cleanup
- [ ] Remove dead code from `filter-operations.tsx`.
- [ ] `tsc --noEmit` clean.
- [ ] Update `apps/web/CLAUDE.md` with new route.

## Decisions (confirmed by user)
1. **Mobile**: YES — also refactor `mobile-operations.tsx` (APK uses it).
2. **After submit**: stay on the stage screen until the user navigates back themselves.
3. **Block selection**: only required on **WASH_IN** and **DRY_IN** screens. All other stages skip the block selector.

## Review section
_To be filled after implementation._
