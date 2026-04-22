# Plan: Pi Gremlins Optimization Remediation Findings 1-6

- **Status:** Revised again for remaining Task 1 extraction blocker, self-reviewed, ready for execution
- **Date:** 2026-04-21
- **Scope:** `extensions/pi-gremlins` only
- **Primary objective:** Remove avoidable repeated work and memory churn behind findings 1-6 without changing user-visible behavior.
- **Verification baseline:** `npm run typecheck`, `npm test`

## Scope and Evidence Summary

Observed hotspots from current code:

1. **Repeated discovery/package resolution per invocation** in `extensions/pi-gremlins/index.ts` (`tryResolvePackagePaths()`, `discoverAgentsWithPackages()` on every tool execute).
2. **Progress updates clone growing result graphs per event** in `extensions/pi-gremlins/single-agent-runner.ts` and `extensions/pi-gremlins/execution-modes.ts` (`makeDetails([currentResult])`, `[...allResults]`, `[...viewerResults]`).
3. **`getFinalOutput()` rescans full transcript on each emit** in `extensions/pi-gremlins/single-agent-runner.ts` and `extensions/pi-gremlins/execution-modes.ts`, while `execution-shared.ts` already has result-level derived cache machinery.
4. **Transcript effectively duplicated** in `SingleResult.messages` and `SingleResult.viewerEntries` via `single-agent-runner.ts`, then cloned again for snapshots in `execution-shared.ts`.
5. **Viewer cache invalidation too coarse** in `extensions/pi-gremlins/index.ts`; cache keys use whole invocation revision, so changing one result invalidates body/wrap caches for all selected results.
6. **`extensions/pi-gremlins/index.ts` monolith** (1679 LOC) mixes tool registration, package resolution, invocation snapshotting, viewer overlay, cache helpers, and rendering glue, raising change risk.

## Dependency Order

1. **Task 0 - Safety net first.** Lock current behavior and optimization-proof expectations before changing allocation-heavy paths.
2. **Task 1 - Finding 6 extraction.** Create concrete module seams before deeper optimization in `index.ts`.
3. **Task 2 - Finding 1 discovery/package caching.** Land session cache only after extraction boundary exists.
4. **Task 3 - Finding 2 progress update churn.** Reduce per-event array/object copying once update/controller boundaries are smaller.
5. **Task 4 - Finding 5 viewer cache granularity.** Easier after snapshot/viewer code is split and live update churn is reduced.
6. **Task 5 - Finding 3 final output caching.** Align emit path to result-derived cache before changing storage model.
7. **Task 6 - Finding 4 transcript de-duplication.** Highest-risk data-shape change. Do last, after render/final-output consumers stop depending on repeated full transcript scans.
8. **Task 7 - Full regression pass and dead-code cleanup.** Remove superseded helpers, unused imports/exports, and temporary extraction shims/barrels.

## Task 0 - Add regression coverage for optimization seams and external contracts

- **What:** Add or extend targeted characterization tests that freeze current semantics for package discovery precedence, progress update ordering, snapshot structural sharing, viewer body/wrap caching, final output selection, transcript fallback, and single/parallel/chain output integrity. Include optimization-proof assertions for findings 1, 3, and 5 so later work proves reduced repeated work rather than only matching text output.
- **Findings covered:** prerequisite for 1-6; explicit proof harness for 1, 3, 5.
- **References:**
  - `extensions/pi-gremlins/agents.test.js`
  - `extensions/pi-gremlins/index.execute.test.js`
  - `extensions/pi-gremlins/index.viewer.test.js`
  - `extensions/pi-gremlins/index.render.test.js`
- **Acceptance criteria:**
  - Tests exist for repeated execute calls under same `cwd`/`agentScope` and can distinguish cache hit vs miss conditions later used by Task 2.
  - Tests exist for live progress updates without semantic regressions in single, parallel, and chain modes.
  - Tests exist for snapshot structural sharing and snapshot isolation.
  - Tests exist for `details.results` contract preservation:
    - when `viewerEntries` exist, `details.results[n].viewerEntries` remains populated and drives final output/viewer rendering;
    - when `viewerEntries` are absent, `details.results[n].messages` remains sufficient for fallback rendering/final output;
    - when `details.viewerResults` exists, it does not break `details.results` caller expectations.
  - Optimization-proof assertions are present for:
    - **Finding 1:** repeated same-context executes can later assert resolver/discovery call counts stay flat on cache hit;
    - **Finding 3:** repeated final-output reads for unchanged result revision can later assert derived render cache reuse and invalidation only on transcript revision change;
    - **Finding 5:** updates to unrelated results can later assert selected-result body/wrap caches stay hot.
- **Guardrails:**
  - No production logic changes bundled into this task.
  - Do not snapshot incidental formatting unrelated to findings.
  - Prefer assertions on contract fields, call counts, cache-hit booleans, and object identity over brittle full-output snapshots.
- **Verification:**
  - `bun test extensions/pi-gremlins/agents.test.js`
  - `bun test extensions/pi-gremlins/index.execute.test.js`
  - `bun test extensions/pi-gremlins/index.viewer.test.js`
  - `bun test extensions/pi-gremlins/index.render.test.js`

## Task 1 - Finding 6: Extract `index.ts` into concrete focused modules before optimization

- **What:** Perform minimal-risk decomposition of `extensions/pi-gremlins/index.ts` so later optimizations land behind smaller, testable boundaries. Make viewer extraction dependency-closed first so extracted viewer modules do not depend on symbols stranded in `index.ts`. Move code verbatim first. No logic rewrite in this task.
- **Findings covered:** 6; enables 1, 2, 5.
- **References:**
  - source: `extensions/pi-gremlins/index.ts`
  - adjacent modules: `extensions/pi-gremlins/execution-shared.ts`, `extensions/pi-gremlins/viewer-result-navigation.ts`, `extensions/pi-gremlins/viewer-open-action.ts`, `extensions/pi-gremlins/agents.ts`, `extensions/pi-gremlins/result-rendering.ts`
  - tests: `extensions/pi-gremlins/index.execute.test.js`, `extensions/pi-gremlins/index.viewer.test.js`, `extensions/pi-gremlins/index.render.test.js`
- **Target destination files and extraction map:**
  - `extensions/pi-gremlins/package-discovery.ts`
    - move `PackageResolutionAttempt`
    - move `tryResolvePackagePaths()`
  - `extensions/pi-gremlins/invocation-state.ts`
    - move `InvocationSnapshot`
    - move `isSameResultSnapshotSlot()`
    - move `createInvocationSnapshot()`
    - move `isTerminalInvocationStatus()`
    - move `isProgressOnlyInvocationUpdate()`
    - move `createInvocationUpdateController()`
    - move `pruneInvocationRegistry()`
  - `extensions/pi-gremlins/tool-call-formatting.ts`
    - move `formatToolCall()`
    - make this shared formatting module authoritative for both viewer rendering and `index.ts`/`result-rendering.ts` composition
  - `extensions/pi-gremlins/viewer-body-cache.ts`
    - move viewer-specific constants and cache types so viewer modules stay self-sufficient:
      - `VIEWER_TITLE`
      - `ViewerBodyCacheEntry`
      - `ViewerWrapCacheEntry`
    - move viewer line builders and cache helpers:
      - `formatViewerStatusBadge()`
      - `formatViewerSourceBadge()`
      - `pushViewerTextBlock()`
      - `buildViewerStateLines()`
      - `buildViewerFallbackLines()`
      - `buildViewerEntryLines()`
      - `buildInvocationBodyLines()`
      - `buildViewerTitleLine()`
      - `buildViewerMetadataLine()`
      - `buildViewerTelemetryLine()`
      - `buildViewerInvocationLine()`
      - `getCachedInvocationBodyLines()`
      - `getCachedWrappedBodyLines()`
  - `extensions/pi-gremlins/viewer-overlay.ts`
    - move `PiGremlinsViewerOverlay`
    - have overlay import viewer-owned constants/cache types from `viewer-body-cache.ts` and snapshot types/helpers from `invocation-state.ts`, never from `index.ts`
  - `extensions/pi-gremlins/index.ts`
    - retain extension registration, remaining tool schema/constants, mode dispatch wiring, command registration, and composition-only orchestration
    - import `formatToolCall()` from `tool-call-formatting.ts` rather than owning viewer/render formatting directly
- **Acceptance criteria:**
  - `index.ts` becomes composition-oriented entrypoint rather than helper monolith.
  - Extracted symbols live in exact destination files above.
  - Viewer extraction is dependency-closed: `viewer-body-cache.ts` and `viewer-overlay.ts` compile using only extracted/shared neighbors and external deps, with no back-import from `index.ts`.
  - `VIEWER_TITLE`, `ViewerBodyCacheEntry`, `ViewerWrapCacheEntry`, and `formatToolCall()` no longer live exclusively in `index.ts` before viewer extraction is considered complete.
  - **Hard boundary rule:** extracted modules never import `./index.ts` or `./index.js`; dependency direction stays one-way from `index.ts` into extracted modules.
  - No circular imports introduced across `index.ts`, `package-discovery.ts`, `invocation-state.ts`, `tool-call-formatting.ts`, `viewer-body-cache.ts`, `viewer-overlay.ts`, or existing neighbors.
  - Export surface stays stable enough for current tests/importers during extraction.
  - Follow-up tasks can modify discovery, viewer cache, and invocation state without reopening unrelated registration code.
- **Guardrails:**
  - No behavior changes beyond symbol relocation and import rewiring.
  - No new top-level folders outside `extensions/pi-gremlins`.
  - No duplicate helper copies.
  - Do not leave `viewer-body-cache.ts` or `viewer-overlay.ts` depending on symbols still owned only by `index.ts`.
  - If temporary `index.ts` pass-through named exports are needed to keep tests green during extraction, track them explicitly, limit them to short-lived compatibility only, and remove them in Task 7 after importer audit confirms direct imports are updated.
  - Do not create new barrel files beyond `index.ts`.
- **Verification:**
  - Boundary audit: `rg -n 'from "\./index|from "\./index\.js|from "\./index\.ts' extensions/pi-gremlins/package-discovery.ts extensions/pi-gremlins/invocation-state.ts extensions/pi-gremlins/tool-call-formatting.ts extensions/pi-gremlins/viewer-body-cache.ts extensions/pi-gremlins/viewer-overlay.ts`
  - Cycle audit primary: `npx madge --circular extensions/pi-gremlins/index.ts extensions/pi-gremlins/package-discovery.ts extensions/pi-gremlins/invocation-state.ts extensions/pi-gremlins/tool-call-formatting.ts extensions/pi-gremlins/viewer-body-cache.ts extensions/pi-gremlins/viewer-overlay.ts`
  - Cycle audit fallback if `npx madge` unavailable: `rg -n '^import .* from ' extensions/pi-gremlins/index.ts extensions/pi-gremlins/package-discovery.ts extensions/pi-gremlins/invocation-state.ts extensions/pi-gremlins/tool-call-formatting.ts extensions/pi-gremlins/viewer-body-cache.ts extensions/pi-gremlins/viewer-overlay.ts` plus manual verification that extracted-module import graph is acyclic and no dependency path returns to `index.ts`
  - `npm run typecheck`
  - `npm test`

## Task 2 - Finding 1: Cache package resolution and agent discovery per session/context

- **What:** Stop resolving packages and rediscovering agents on every invocation when lookup context and source freshness have not changed.
- **Findings covered:** 1.
- **References:**
  - `extensions/pi-gremlins/package-discovery.ts`
  - `extensions/pi-gremlins/index.ts`
  - `extensions/pi-gremlins/agents.ts`
  - `extensions/pi-gremlins/agents.test.js`
  - `extensions/pi-gremlins/index.execute.test.js`
- **Cache contract:**
  - Use session-local cache map keyed by exact lookup context: `${cwd}::${agentScope}`.
  - Cache entry stores:
    - `resolvedPaths` result from package resolution
    - `warning` string from package resolution failure/no-support path
    - discovered `agents`
    - `projectAgentsDir`
    - freshness signature captured at populate time
  - Freshness signature must include all inputs that can change effective discovery output:
    - `cwd`
    - `agentScope`
    - user agent source fingerprint: `getAgentDir()/agents` path plus sorted `*.md` file paths and mtimes
    - project agent source fingerprint: resolved nearest `.pi/agents` path (or `null`) plus sorted `*.md` file paths and mtimes
    - package agent source fingerprint: package warning text plus sorted enabled package agent resource paths from `resolvedPaths.agents`, with path and file mtime when readable
  - Changed package-resolution warning text or changed resolved package agent resource set must force cache miss.
- **Freshness and invalidation policy:**
  - Support **lazy mid-session invalidation on next tool execute**: each execute recomputes freshness signature for the current context and refreshes stale entries before use.
  - No background watcher or proactive push invalidation required between executes.
  - Keep whole-session reset on `session_start` and `session_shutdown`.
- **Acceptance criteria:**
  - Repeated tool executions in same session and same fresh context reuse cached discovery/package data.
  - Different `cwd` or different `agentScope` never reuses wrong cache entry.
  - Touching user/project/package agent inputs or changing package-resolution warning/result causes deterministic cache miss and refresh.
  - Package resolution failure warning text remains user-visible and correct after cache hit/miss transitions.
  - Agent precedence and project-agent confirmation semantics remain unchanged.
  - Tests explicitly cover cache hit and miss paths, not only final output text.
- **Guardrails:**
  - No cross-session persistence.
  - No stale cache across different repository roots.
  - Do not change agent precedence or confirmation policy.
  - Do not hide package-resolution warnings behind stale cached success state, or stale warnings behind recovered success state.
- **Verification:**
  - `bun test extensions/pi-gremlins/agents.test.js`
  - `bun test extensions/pi-gremlins/index.execute.test.js`
  - `npm run typecheck`

## Task 3 - Finding 2: Remove per-event cloning of growing result graphs

- **What:** Reduce allocation churn in live updates so child events stop rebuilding expanding arrays/details payloads on each emit.
- **Findings covered:** 2.
- **References:**
  - `extensions/pi-gremlins/single-agent-runner.ts`
  - `extensions/pi-gremlins/execution-modes.ts`
  - `extensions/pi-gremlins/execution-shared.ts`
  - `extensions/pi-gremlins/invocation-state.ts`
  - `extensions/pi-gremlins/index.execute.test.js`
- **Change strategy:**
  - Replace per-event `makeDetails([currentResult])`, `[...allResults]`, and `[...viewerResults]` copies with stable live collections plus targeted slot replacement.
  - Keep immutable cloning at snapshot publication boundary only.
  - Preserve current terminal text, progress ordering, and `details.results`/`details.viewerResults` contract fields.
- **Acceptance criteria:**
  - Single-run progress emits without rebuilding full result graphs on every child event.
  - Parallel and chain updates reuse stable arrays for unchanged results while still producing correct snapshots.
  - Snapshot history remains isolated from later mutation.
  - `details.results` and `details.viewerResults` stay contract-compatible for current callers/tests.
- **Guardrails:**
  - Do not mutate already-published snapshots.
  - Do not drop intermediate progress updates or reorder them.
  - Do not couple single/parallel/chain paths to viewer-only concerns.
- **Verification:**
  - `bun test extensions/pi-gremlins/index.execute.test.js`
  - `bun test extensions/pi-gremlins/index.viewer.test.js`
  - `npm run typecheck`

## Task 4 - Finding 5: Make viewer cache invalidation result-scoped instead of invocation-scoped

- **What:** Tighten viewer body/wrap cache keys so updates to one result do not invalidate cached body lines for unrelated selected results.
- **Findings covered:** 5.
- **References:**
  - `extensions/pi-gremlins/viewer-body-cache.ts`
  - `extensions/pi-gremlins/viewer-overlay.ts`
  - `extensions/pi-gremlins/execution-shared.ts`
  - `extensions/pi-gremlins/viewer-result-navigation.ts`
  - `extensions/pi-gremlins/index.viewer.test.js`
- **Change strategy:**
  - Base body cache on selected result identity plus selected result visible/derived revision, not whole invocation revision.
  - Base wrapped-body cache on body-cache identity/content revision plus width, not whole invocation revision.
  - Keep higher-level invocation chrome refreshes separate from selected-result body invalidation.
- **Acceptance criteria:**
  - Updating result A does not force body/wrap rebuild for selected result B.
  - Switching selected result still produces correct cache misses/hits.
  - Resizing viewer still invalidates wrap cache correctly.
  - Viewer content remains accurate for running, completed, failed, and canceled states.
  - Optimization-proof assertions verify selected-result cache entries remain hot across unrelated result updates, while selected-result revision change still forces deterministic miss.
- **Guardrails:**
  - No stale body text after result selection changes.
  - No cache key based on object identity alone if snapshots can be cloned.
  - Do not regress short/narrow viewer behavior.
- **Verification:**
  - `bun test extensions/pi-gremlins/index.viewer.test.js`
  - `bun test extensions/pi-gremlins/viewer-result-navigation.test.js`
  - `npm run typecheck`

## Task 5 - Finding 3: Replace repeated full-transcript `getFinalOutput()` scans with result-derived cache access

- **What:** Stop rescanning `messages`/`viewerEntries` on every progress emit and summary generation.
- **Findings covered:** 3.
- **References:**
  - `extensions/pi-gremlins/execution-shared.ts`
  - `extensions/pi-gremlins/single-agent-runner.ts`
  - `extensions/pi-gremlins/execution-modes.ts`
  - `extensions/pi-gremlins/index.render.test.js`
  - `extensions/pi-gremlins/index.execute.test.js`
- **Change strategy:**
  - Promote a `SingleResult`-based accessor such as `getResultFinalOutput(result)` that reuses `getDerivedRenderData(result)`.
  - Replace hot-path call sites that currently pass raw transcript arrays.
  - Keep viewer-entry-first semantics and message fallback unchanged.
- **Acceptance criteria:**
  - Hot-path emits no longer require raw-array transcript rescans for unchanged result revisions.
  - Chain carry-forward, single-mode terminal output, and parallel summaries still return identical text.
  - Derived cache invalidates only when result-derived revision changes.
  - Optimization-proof assertions verify repeated final-output reads for unchanged revision reuse cached derived render data and only invalidate after transcript mutation/revision bump.
  - `details.results` fallback contract remains intact when `viewerEntries` are absent.
- **Guardrails:**
  - No change to final output precedence rules.
  - Do not bypass derived cache invalidation semantics.
  - Avoid duplicate caching layers for same value.
- **Verification:**
  - `bun test extensions/pi-gremlins/index.render.test.js`
  - `bun test extensions/pi-gremlins/index.execute.test.js`
  - `npm run typecheck`

## Task 6 - Finding 4: De-duplicate transcript storage while preserving rendering and snapshot semantics

- **What:** Remove or materially reduce duplicated transcript storage between `messages` and `viewerEntries` while preserving external result contracts.
- **Findings covered:** 4.
- **References:**
  - `extensions/pi-gremlins/execution-shared.ts`
  - `extensions/pi-gremlins/single-agent-runner.ts`
  - `extensions/pi-gremlins/result-rendering.ts`
  - `extensions/pi-gremlins/index.render.test.js`
  - `extensions/pi-gremlins/index.viewer.test.js`
  - `extensions/pi-gremlins/index.execute.test.js`
- **Change strategy:**
  - Make one structure canonical for presentation and final-output derivation (`viewerEntries` when present).
  - Retain only minimal `messages` data still required for fallback rendering, compatibility, or protocol/debug paths.
  - Update snapshot cloning and derived-cache logic to avoid deep-cloning redundant transcript payloads.
- **Acceptance criteria:**
  - Same assistant/tool transcript content is not stored twice by default for live runs.
  - Rendering, final output, chain handoff, and failure messaging remain correct.
  - Snapshot copies shrink by avoiding redundant transcript duplication.
  - Tests explicitly cover `details.results` fallback contracts:
    - `viewerEntries`-present path still returns correct viewer/final-output behavior;
    - `viewerEntries`-absent path still returns correct message fallback behavior;
    - callers reading `details.results` do not need to switch to internal storage details.
- **Guardrails:**
  - Do not remove data still required for message-only fallback tests.
  - Do not break external tool result contract fields returned in `details`.
  - Keep debugging/error surfaces adequate for failed child runs.
- **Verification:**
  - `bun test extensions/pi-gremlins/index.render.test.js`
  - `bun test extensions/pi-gremlins/index.viewer.test.js`
  - `bun test extensions/pi-gremlins/index.execute.test.js`
  - `npm run typecheck`

## Task 7 - Final verification and dead-code cleanup

- **What:** Run full extension regression suite, remove superseded helpers/imports/exports, and remove temporary extraction shims/barrels once unused.
- **Findings covered:** closure for 1-6.
- **References:**
  - `extensions/pi-gremlins/index.ts`
  - `extensions/pi-gremlins/package-discovery.ts`
  - `extensions/pi-gremlins/invocation-state.ts`
  - `extensions/pi-gremlins/tool-call-formatting.ts`
  - `extensions/pi-gremlins/viewer-body-cache.ts`
  - `extensions/pi-gremlins/viewer-overlay.ts`
  - `extensions/pi-gremlins/execution-shared.ts`
  - `extensions/pi-gremlins/execution-modes.ts`
  - `extensions/pi-gremlins/single-agent-runner.ts`
  - `extensions/pi-gremlins/agents.ts`
  - `extensions/pi-gremlins/result-rendering.ts`
  - `extensions/pi-gremlins/viewer-result-navigation.ts`
  - `extensions/pi-gremlins/viewer-open-action.ts`
- **Acceptance criteria:**
  - No unused imports/exports/helpers left from extraction or cache rewrites.
  - Any temporary `index.ts` pass-through exports or extraction-only shims introduced in Task 1 are removed once no direct consumers remain.
  - Importer audit confirms no internal module or test still depends on temporary pass-through exports from `index.ts` before those exports are removed.
  - No unused barrel module remains.
  - Full test suite passes.
  - Typecheck passes.
  - No finding remains partially addressed behind dead compatibility code without explicit reason.
- **Guardrails:**
  - Do not delete fallback code still required by tests.
  - No scope expansion beyond `extensions/pi-gremlins` tests and source.
  - Verify references before removing any shim/export/file.
- **Verification:**
  - `npm run typecheck`
  - `npm test`
  - `rg -n 'export .* from "\./(package-discovery|invocation-state|tool-call-formatting|viewer-body-cache|viewer-overlay)"' extensions/pi-gremlins`
  - `rg -n 'from "\./index(\.js|\.ts)?"|from "\.\./index(\.js|\.ts)?"' extensions/pi-gremlins`

## Risk Register

- **Highest risk - Finding 4:** data-shape change can break render fallback, chain carry-forward, or snapshot isolation if done before Finding 3 settles cache access.
- **Medium risk - Finding 2:** over-optimizing live updates can accidentally mutate already-published snapshots.
- **Medium risk - Finding 5:** finer cache keys can create stale viewer text if keyed too narrowly.
- **Medium risk - Finding 1:** stale discovery cache if freshness signature omits package warning/result transitions or any agent source fingerprint.
- **Cross-cutting risk - Finding 6:** extraction can introduce circular imports or hidden index re-entry if dependency direction is not enforced.

## Execution Notes

- Keep each task reviewable and shippable.
- Prefer adding targeted tests first for each finding, then implement, then rerun affected tests before moving to next task.
- Preserve external tool behavior and user-facing output unless a test explicitly updates expected formatting for equivalent semantics.
- Treat optimization-proof assertions as required evidence, not optional nice-to-have checks.
- Treat `details.results` as external contract surface; internal storage changes must preserve caller-visible semantics.

## Self-Review

- Dependency order checked and preserved: yes.
- Task 1 extraction now names exact destination files and symbol mapping, including viewer dependency closure for `VIEWER_TITLE`, viewer cache entry types, and `formatToolCall()`: yes.
- Task 1 boundary rule forbidding extracted-module imports from `index.ts` remains intact without leaving viewer-only symbols behind: yes.
- Task 1 cycle/boundary verification now includes `tool-call-formatting.ts` and fallback audit when `npx madge` is unavailable: yes.
- Task 2 cache key, freshness signature, warning/result invalidation, hit/miss tests, and mid-session invalidation policy made explicit: yes.
- Optimization-proof assertions for findings 1, 3, and 5 strengthened: yes.
- `details.results` transcript/viewerEntries fallback contract assertions added: yes.
- Task 7 now requires importer audit before removing temporary `index.ts` pass-through exports: yes.
- Scope limited to plan artifact only: yes.
