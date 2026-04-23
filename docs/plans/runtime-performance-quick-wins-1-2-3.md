# Plan: Runtime Performance Quick Wins Findings 1, 2, 3

- **Status:** Drafted, self-reviewed, ready for execution
- **Date:** 2026-04-23
- **Scope:** `extensions/pi-gremlins` runtime update paths only
- **Primary objective:** Remove avoidable repeated string/object/summary rebuilding for findings 1, 2, 3 without changing behavior, public contract, or rendered output semantics.
- **In scope:**
  - Finding 1: streaming text accumulation churn in `gremlin-runner.ts`
  - Finding 2: progress store/scheduler full-store cloning and recount churn
  - Finding 3: progress summary full-batch rebuild on every update
- **Out of scope:**
  - Findings 4, 5, 6
  - PRD/ADR work
  - Public schema changes
  - Unrelated refactors

## Scope and Evidence Summary

Observed hotspots from current code:

1. **Streaming text accumulation copies full string on every delta** in `extensions/pi-gremlins/gremlin-runner.ts:185-191` via ```${state.latestText ?? ""}${delta}`.trim()``. Impact: every token chunk rebuilds whole accumulated string and trims whole buffer again.
2. **Progress updates rebuild whole detail graph and recount every status on each patch** in `extensions/pi-gremlins/gremlin-progress-store.ts:53-58,69-90` and `extensions/pi-gremlins/gremlin-scheduler.ts:58-62,89-97`. Impact: each child update clones all entries and rescans all statuses before publish.
3. **Progress summary rebuilds headline plus every gremlin line on each update** in `extensions/pi-gremlins/index.ts:149-158` and `extensions/pi-gremlins/gremlin-summary.ts:15-20,40-43`. Impact: every live patch regenerates whole batch string even when one entry changed.

## Execution Order

1. **Task 0 - characterization coverage first.** Freeze current behavior for streaming aggregation, progress snapshots, and progress text.
2. **Task 1 - finding 1 streaming accumulation.** Remove repeated full-string trim/copy from hot path.
3. **Task 2 - finding 2 progress store/scheduler churn.** Move to incremental counters and targeted snapshot invalidation.
4. **Task 3 - finding 3 summary rebuild churn.** Cache batch summary parts by revision so unchanged lines stay hot.
5. **Task 4 - final regression and dead-code pass.** Re-run focused verification, remove superseded helpers/imports if any.

## Task 0 - Add targeted regression coverage for current contracts

- **What:** Extend focused tests so optimization work proves behavior remains identical for text streaming, detail snapshots, scheduler updates, and rendered summary text.
- **References:**
  - `extensions/pi-gremlins/gremlin-runner.test.js`
  - `extensions/pi-gremlins/gremlin-scheduler.test.js`
  - `extensions/pi-gremlins/index.execute.test.js`
  - `extensions/pi-gremlins/index.render.test.js`
  - `extensions/pi-gremlins/gremlin-summary.ts`
- **Acceptance criteria:**
  - Tests cover multi-delta assistant streaming and assert final `latestText` content stays same as today.
  - Tests cover repeated scheduler/store updates and assert published `details` counts and per-gremlin states remain correct across queued, active, completed, failed, canceled transitions.
  - Tests cover progress update text and assert inline summary content remains semantically unchanged for unchanged behavior.
  - At least one test can detect object/snapshot isolation boundary: later updates must not mutate already-published snapshot objects.
- **Guardrails:**
  - No production logic changes in this task.
  - Do not lock tests to incidental whitespace beyond current contract requirements.
  - Prefer assertions on fields and representative summary lines, not brittle giant snapshots.
- **Verification:**
  - `bun test extensions/pi-gremlins/gremlin-runner.test.js`
  - `bun test extensions/pi-gremlins/gremlin-scheduler.test.js`
  - `bun test extensions/pi-gremlins/index.execute.test.js`
  - `bun test extensions/pi-gremlins/index.render.test.js`

## Task 1 - Finding 1: remove repeated full-string rebuild on streamed text deltas

- **What:** Change live text accumulation in `gremlin-runner.ts` so repeated `text_delta` events stop doing full-buffer template concat plus whole-string trim on every event, while still publishing same user-visible `latestText` semantics.
- **References:**
  - `extensions/pi-gremlins/gremlin-runner.ts`
  - `extensions/pi-gremlins/gremlin-runner.test.js`
- **Implementation direction:**
  - Inspect current `state.latestText` lifecycle and isolate streaming-only accumulation from finalized text publication.
  - Prefer append-only buffer strategy for deltas with trim/normalization applied only when needed for publication boundary or final message replacement.
  - Preserve final `message_end` overwrite behavior and tool-phase update behavior.
- **Acceptance criteria:**
  - `text_delta` handling no longer uses repeated full-buffer template concat + `.trim()` for each chunk.
  - Final `latestText` values observed by callers match current behavior for leading/trailing whitespace normalization and completed-message replacement.
  - Tool execution updates and terminal result shaping remain unchanged.
  - No public field names, event ordering, or result contract changes.
- **Guardrails:**
  - Do not change how `message_end` final text wins over streamed partial text.
  - Do not change cancellation/failure semantics.
  - Do not add generalized transcript storage or unrelated helpers.
- **Verification:**
  - `bun test extensions/pi-gremlins/gremlin-runner.test.js`
  - `npm run typecheck`

## Task 2 - Finding 2: stop cloning whole store and recounting statuses on every patch

- **What:** Rework progress detail generation so per-entry patches update only changed entry state and incremental status counters, while snapshots still remain immutable for consumers.
- **References:**
  - `extensions/pi-gremlins/gremlin-progress-store.ts`
  - `extensions/pi-gremlins/gremlin-scheduler.ts`
  - `extensions/pi-gremlins/gremlin-scheduler.test.js`
  - `extensions/pi-gremlins/index.execute.test.js`
- **Implementation direction:**
  - Replace `entries.find(...)` lookup path with direct indexed or mapped access by `gremlinId` if needed for hot updates.
  - Track status counts incrementally when entry status changes instead of recomputing with repeated `filter()` scans.
  - Separate internal mutable store from externally published snapshot objects.
  - Let scheduler use store-returned snapshot/update result directly so it does not call `snapshot()` again after already mutating state.
- **Acceptance criteria:**
  - Entry patch/update path no longer rescans every entry to recompute counts on each live patch.
  - Scheduler no longer performs redundant `update()/complete()` then `snapshot()` sequence for same event.
  - Published `GremlinInvocationDetails` stays immutable from caller perspective.
  - All status counters remain correct for queued, starting, active, completed, failed, and canceled transitions.
  - Parallel batch behavior, abort behavior, and final result ordering remain unchanged.
- **Guardrails:**
  - Do not mutate already-published snapshot arrays or entry objects.
  - Do not change `gremlinId` assignment, result ordering, or aggregate error semantics.
  - Do not introduce persistence or cross-batch shared state.
- **Verification:**
  - `bun test extensions/pi-gremlins/gremlin-scheduler.test.js`
  - `bun test extensions/pi-gremlins/index.execute.test.js`
  - `npm run typecheck`

## Task 3 - Finding 3: avoid rebuilding whole batch summary string on every update

- **What:** Make progress summary generation reuse stable headline/entry formatting where revisions have not changed, so one-entry updates stop rebuilding full batch text every time.
- **References:**
  - `extensions/pi-gremlins/index.ts`
  - `extensions/pi-gremlins/gremlin-summary.ts`
  - `extensions/pi-gremlins/gremlin-render-components.ts`
  - `extensions/pi-gremlins/gremlin-rendering.ts`
  - `extensions/pi-gremlins/index.execute.test.js`
  - `extensions/pi-gremlins/index.render.test.js`
- **Implementation direction:**
  - Keep `buildGremlinProgressSummary(details)` public contract unchanged.
  - Introduce revision-aware memoization for summary headline and per-entry rendered lines, keyed from batch counts plus entry revision/id.
  - Reuse existing per-entry render caching where possible instead of duplicating format logic.
  - Ensure final batch summary and live progress summary remain text-compatible with current output.
- **Acceptance criteria:**
  - Progress summary generation no longer rebuilds every gremlin line string on every single-entry update when unaffected entries are unchanged.
  - Headline invalidates only when aggregate counts change.
  - Per-entry lines invalidate only when that entry revision-visible fields change.
  - Tool execute live updates in `index.ts` still publish correct text and details payloads.
  - Final result summary text remains unchanged for completed, failed, canceled, and mixed batches.
- **Guardrails:**
  - Do not change human-facing wording, line order, or public tool response shape.
  - Do not create second rendering path that can drift from existing collapsed-line formatting.
  - Do not couple summary cache to session-global mutable state beyond bounded in-memory cache local to module.
- **Verification:**
  - `bun test extensions/pi-gremlins/index.execute.test.js`
  - `bun test extensions/pi-gremlins/index.render.test.js`
  - `npm run typecheck`

## Task 4 - Final regression pass and dead-code cleanup

- **What:** Re-read touched files, remove superseded helper paths/imports, confirm no dead code remains from optimization changes, then run combined verification.
- **References:**
  - `extensions/pi-gremlins/gremlin-runner.ts`
  - `extensions/pi-gremlins/gremlin-progress-store.ts`
  - `extensions/pi-gremlins/gremlin-scheduler.ts`
  - `extensions/pi-gremlins/index.ts`
  - `extensions/pi-gremlins/gremlin-summary.ts`
  - touched tests above
- **Acceptance criteria:**
  - No unused imports/exports/helpers remain in touched files.
  - No behavior drift detected by focused tests.
  - TypeScript compile passes for touched runtime paths.
- **Guardrails:**
  - Cleanup only dead code created or exposed by Tasks 1-3.
  - No opportunistic refactors outside stated scope.
- **Verification:**
  - `bun test extensions/pi-gremlins/gremlin-runner.test.js`
  - `bun test extensions/pi-gremlins/gremlin-scheduler.test.js`
  - `bun test extensions/pi-gremlins/index.execute.test.js`
  - `bun test extensions/pi-gremlins/index.render.test.js`
  - `npm run typecheck`

## Key Assumptions

- **Observed:** `GremlinInvocationEntry.revision` and `GremlinInvocationDetails.revision` already exist and can serve as invalidation signals for cached summary work.
- **Observed:** `formatCollapsedGremlinLine()` already has entry-level caching in `gremlin-render-components.ts`; summary optimization should reuse that instead of inventing incompatible formatting.
- **Inferred:** Focused Bun tests plus `npm run typecheck` are smallest relevant verification set for these runtime-only changes.
- **Inferred:** No PRD/ADR needed because scope is implementation-only optimization with no contract change.

## Risks / Unknowns

- **Unknown:** Exact whitespace semantics desired for streamed `text_delta` accumulation if current `.trim()` behavior was masking leading-space chunk boundaries. Task 0 must freeze expected behavior before Task 1 changes hot path.
- **Unknown:** Whether any external caller depends on fresh object identity from every `onUpdate` snapshot beyond immutability. Plan preserves new snapshot publication, but execution should verify tests around isolation and consumer expectations.
- **Inferred:** Summary optimization must avoid fighting existing render caches in `gremlin-render-components.ts` and `gremlin-rendering.ts`; safest path is revision-aware reuse, not parallel formatting logic.
