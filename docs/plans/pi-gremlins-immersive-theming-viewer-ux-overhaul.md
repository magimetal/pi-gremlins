# Plan: Pi Gremlins Immersive Theming and Viewer UX Overhaul

- **Status:** Draft for execution
- **Date:** 2026-04-21
- **Scope:** `extensions/pi-gremlins` only
- **References:** PRD-0001, ADR-0001
- **Primary objective:** Deliver phased UX/theming/viewer overhaul for `pi-gremlins` without changing session-local architecture and without introducing persistence/history.

## Planning Assumptions

- PRD-0001 remains product source of truth for scope and acceptance.
- ADR-0001 remains architecture source of truth: shared semantic presentation layer, `viewerEntries` event projection, no persistence/history.
- Work stays inside `extensions/pi-gremlins` plus tests under same directory.
- Existing `viewerEntries` path becomes canonical presentation input where entries exist; message-derived rendering remains temporary fallback until parity proven.
- Narrow-width and reduced-height behavior must degrade intentionally, not by incidental wrapping.
- Any motion remains optional-in-effect, subtle, and removable without semantic loss.

## Hard Guardrails

- Preserve current session-local snapshot architecture. No persistence. No cross-session history. No storage model changes.
- Do not expand scope outside `extensions/pi-gremlins` except this plan file.
- Do not change agent trust policy. Only surface existing trust-relevant semantics more clearly.
- Do not let color become sole status signal. Badges/labels required.
- Do not delete fallback message rendering until semantic parity tests pass.
- Keep gremlin personality restrained. Distinctive OK. No noisy chrome.

## PRD / ADR Traceability Map

### PRD-0001 Acceptance Criteria Map

- **AC-1:** Shared semantic vocabulary for `Running`, `Completed`, `Failed`, `Canceled`; explicit non-color-only badges.
- **AC-2:** Embedded active-run clarity; active row or equivalent live focus.
- **AC-3:** Embedded rendering consumes `viewerEntries` semantic feed when entries exist.
- **AC-4:** Popup viewer differentiates assistant text, tool calls, tool results, streaming, truncation, errors; reduced separator clutter.
- **AC-5:** Parallel/chain hierarchy and progression clearer, including narrow-size readability.
- **AC-6:** Agent source and trust-relevant context visible where interpretation changes.
- **AC-7:** Usage stats scannable: turns, token flow, cache, context, cost, model.
- **AC-8:** Empty/running/error states themed and helpful; viewer discoverability hints consistent.
- **AC-9:** Narrow-width and reduced-height layouts preserve essentials.
- **AC-10:** No persistence/history/cross-session surfaces introduced.
- **AC-11:** Automated coverage for rendering, popup behavior, running semantics, `viewerEntries` summaries, responsive behavior.

### ADR-0001 Decision Hooks

- **ADR-D1:** Shared semantic presentation layer backed by `viewerEntries` event projection.
- **ADR-D2:** Embedded and popup surfaces must converge on one canonical runtime presentation model.
- **ADR-D3:** Session-local only. No persistence/history/config migration.

## Dependency Logic

1. **Semantic foundation first.** Needed before visible restyling. Matches PRD sequencing and ADR-D1/D2.
2. **Running-state correctness closes inside Phase 1.** Live UX work in later phases stays blocked until state truth and active-step projection are proven reliable for single, parallel, and chain runs.
3. **Embedded redesign third.** Most frequent surface. Also proves semantic model under density pressure.
4. **Popup viewer overhaul fourth.** Reuse same semantics and vocabulary after embedded patterns settle.
5. **Parity hardening and polish last.** Only after both surfaces pass shared regression gates.

## Workstream-to-Phase Map

| Workstream | Phase | Primary files/components |
| --- | --- | --- |
| Semantic style layer | 1 | `extensions/pi-gremlins/execution-shared.ts`, `extensions/pi-gremlins/result-rendering.ts` |
| Shared event projection from `viewerEntries` | 1 | `extensions/pi-gremlins/index.ts`, `extensions/pi-gremlins/execution-shared.ts` |
| Running-state semantic fix | 1 | `extensions/pi-gremlins/execution-shared.ts`, `extensions/pi-gremlins/execution-modes.ts`, `extensions/pi-gremlins/result-rendering.ts` |
| Embedded compact-live redesign | 2 | `extensions/pi-gremlins/result-rendering.ts` |
| Explicit status badges | 1-3 | `extensions/pi-gremlins/execution-shared.ts`, `extensions/pi-gremlins/result-rendering.ts`, `extensions/pi-gremlins/index.ts` |
| Mode-specific identity | 2-3 | `extensions/pi-gremlins/result-rendering.ts`, `extensions/pi-gremlins/index.ts`, `extensions/pi-gremlins/viewer-result-navigation.ts` |
| Source/trust surfacing | 2-3 | `extensions/pi-gremlins/result-rendering.ts`, `extensions/pi-gremlins/index.ts` |
| Viewer chrome upgrade | 3 | `extensions/pi-gremlins/index.ts`, `extensions/pi-gremlins/viewer-result-navigation.ts`, `extensions/pi-gremlins/viewer-open-action.ts` |
| Collapsed-summary redesign | 2 | `extensions/pi-gremlins/result-rendering.ts` |
| Inline tool-result summaries | 2 | `extensions/pi-gremlins/index.ts`, `extensions/pi-gremlins/result-rendering.ts` |
| Popup/embedded semantic unification | 1, 4 | `extensions/pi-gremlins/execution-shared.ts`, `extensions/pi-gremlins/result-rendering.ts`, `extensions/pi-gremlins/index.ts` |
| Usage stat readability | 2-3 | `extensions/pi-gremlins/execution-shared.ts`, `extensions/pi-gremlins/result-rendering.ts`, `extensions/pi-gremlins/index.ts` |
| Adaptive narrow-width mode | 2-3 | `extensions/pi-gremlins/result-rendering.ts`, `extensions/pi-gremlins/viewer-result-navigation.ts`, `extensions/pi-gremlins/index.ts` |
| Themed empty/running/error states | 2-3 | `extensions/pi-gremlins/result-rendering.ts`, `extensions/pi-gremlins/index.ts` |
| Discoverability hints | 2-3 | `extensions/pi-gremlins/result-rendering.ts`, `extensions/pi-gremlins/viewer-open-action.ts`, `extensions/pi-gremlins/index.ts` |
| Timeline/tree enhancements | 3 | `extensions/pi-gremlins/index.ts`, `extensions/pi-gremlins/viewer-result-navigation.ts` |
| Separator reduction | 2-3 | `extensions/pi-gremlins/result-rendering.ts`, `extensions/pi-gremlins/index.ts` |
| Restrained personality | 4 | `extensions/pi-gremlins/result-rendering.ts`, `extensions/pi-gremlins/index.ts` |
| Subtle motion if safe | 4 | `extensions/pi-gremlins/result-rendering.ts`, `extensions/pi-gremlins/index.ts` |

---

## Phase 1 — Semantic Foundation and Canonical Presentation Feed

### Milestone
One canonical semantic presentation contract in place. Embedded and popup can consume same status vocabulary and `viewerEntries`-driven data model. No visual flourish yet.

### Primary files/components

- `extensions/pi-gremlins/execution-shared.ts`
- `extensions/pi-gremlins/index.ts`
- `extensions/pi-gremlins/result-rendering.ts`
- `extensions/pi-gremlins/execution-modes.ts`
- `extensions/pi-gremlins/index.render.test.js`
- `extensions/pi-gremlins/index.viewer.test.js`
- `extensions/pi-gremlins/index.execute.test.js`

### Task 1.1 — Define shared semantic presentation helpers

- **What:** Extend shared extension-local presentation contracts in `execution-shared.ts` so both embedded and popup renderers can consume same semantic state: invocation/result status labels, badge text, mode identity, trust/source labels, usage telemetry labels, and empty/running/error state metadata. Keep helpers purely session-local.
- **References:** `extensions/pi-gremlins/execution-shared.ts`; PRD-0001 AC-1, AC-6, AC-7, AC-8, AC-10; ADR-D1, ADR-D3.
- **Acceptance criteria:** One shared helper surface exists for status naming and semantic labeling; both render paths can import it; no persistence primitives or storage fields added.
- **Guardrails:** No UI-only string duplication across embedded/viewer paths. No config migration. No upstream Pi architecture changes.
- **Verification:** Plan for `npm run typecheck`; targeted tests in `extensions/pi-gremlins/index.render.test.js` and `extensions/pi-gremlins/index.viewer.test.js` asserting identical status/badge vocabulary from shared helpers.

### Task 1.2 — Make `viewerEntries` canonical when present

- **What:** Rework projection/update path so `viewerEntries` remain authoritative semantic feed for assistant text, tool calls, tool results, truncation, streaming, and errors. Ensure snapshot creation and update batching keep using session-local invocation snapshots. Keep message-derived fallback only for results with no projected entries yet.
- **References:** `extensions/pi-gremlins/index.ts`, `extensions/pi-gremlins/execution-shared.ts`, `extensions/pi-gremlins/execution-modes.ts`; PRD-0001 AC-3, AC-4, AC-10; ADR-D1, ADR-D2, ADR-D3.
- **Acceptance criteria:** Embedded renderer can detect and consume `viewerEntries`; popup and embedded no longer drift on tool-call/result semantics when entries exist; fallback still works for minimal/no-entry states.
- **Guardrails:** No history storage. No second canonical presentation source introduced. No breaking change to current execution flow signatures unless covered by tests.
- **Verification:** Plan for `npm run typecheck`; targeted tests in `extensions/pi-gremlins/index.viewer.test.js`, `extensions/pi-gremlins/index.render.test.js`, `extensions/pi-gremlins/index.execute.test.js` covering single/parallel/chain snapshots with `viewerEntries` and fallback-only cases.

### Task 1.3 — Correct running/canceled/failed semantics at data layer

- **What:** Normalize invocation/result status derivation so pending, running, completed, failed, and canceled states reflect actual runtime transitions for single, parallel, and chain modes. Ensure active work can be surfaced later without guessing from final output.
- **References:** `extensions/pi-gremlins/execution-shared.ts`, `extensions/pi-gremlins/execution-modes.ts`, `extensions/pi-gremlins/index.ts`; PRD-0001 AC-1, AC-2, AC-5, AC-11; ADR-D1.
- **Acceptance criteria:** Status derivation stable for partial parallel completion, chain stop-on-failure, cancellation, and no-output-yet cases; running-state correctness for single, parallel, and chain modes is complete before Phase 2 starts; downstream renderers receive reliable state without inferring from exit codes alone.
- **Guardrails:** No cosmetic-only fix. State logic must live in shared layer. Do not mark chain completed early. Do not collapse canceled into failed.
- **Verification:** Plan for targeted tests in `extensions/pi-gremlins/index.execute.test.js` and `extensions/pi-gremlins/index.render.test.js` covering state transitions and active-step truth; Phase 1 gate must pass these before any Phase 2 rendering work begins.

### Phase 1 exit gate

- AC-1 and AC-3 materially satisfied at data-contract level.
- Running/canceled/failed correctness proven for single, parallel, and chain transitions before any Phase 2 rendering task begins.
- Shared tests cover semantic state derivation and `viewerEntries` authority.
- No persistence/history expansion. ADR-0001 still intact.

### Phase 1 risk controls

- Keep message fallback alive behind explicit branch until parity coverage green.
- Land status helpers before any major rendering rewrite.
- Use snapshot-based tests to catch semantic drift before UI polish starts.

---

## Phase 2 — Embedded Live UX Redesign

### Milestone
Embedded tool output becomes fast-scan, status-first, trustworthy, and readable during live runs and completed runs across single/parallel/chain.

### Primary files/components

- `extensions/pi-gremlins/result-rendering.ts`
- `extensions/pi-gremlins/execution-shared.ts`
- `extensions/pi-gremlins/index.ts`
- `extensions/pi-gremlins/execution-modes.ts`
- `extensions/pi-gremlins/index.render.test.js`
- `extensions/pi-gremlins/index.execute.test.js`

### Task 2.1 — Redesign collapsed and expanded embedded summaries

- **What:** Rebuild embedded single/parallel/chain summaries around status-first information hierarchy: explicit status badges, mode-specific identity, agent label, trust/source cues, active summary text, and denser but clearer section framing. Reduce separator noise. Preserve restrained personality.
- **References:** `extensions/pi-gremlins/result-rendering.ts`; PRD-0001 AC-1, AC-5, AC-6, AC-8; ADR-D2.
- **Acceptance criteria:** Collapsed and expanded views show status before prose, mode identity differs for single/parallel/chain, trust/source visible without overwhelming task content, separators/rules materially reduced.
- **Guardrails:** No decorative chrome that competes with content. No color-only state meaning. No duplicated trust copy on every line when one summary badge suffices.
- **Verification:** Plan for snapshot-style tests in `extensions/pi-gremlins/index.render.test.js` covering single/parallel/chain collapsed and expanded output.

### Task 2.2 — Add compact-live running focus and inline tool-result summaries

- **What:** Introduce live density tier for running invocations: active row/current step emphasis, pending-vs-active-vs-finished child clarity, inline tool-result summaries, and better streaming placeholders. Make running work visible before final assistant output exists.
- **References:** `extensions/pi-gremlins/result-rendering.ts`, `extensions/pi-gremlins/index.ts`, `extensions/pi-gremlins/execution-modes.ts`; PRD-0001 AC-2, AC-3, AC-4, AC-5, AC-8; ADR-D1, ADR-D2.
- **Acceptance criteria:** Active work obvious during live runs; compact summaries show current tool/step/task; inline tool-result summaries appear when useful; running states do not collapse into `(running...)` alone.
- **Guardrails:** Do not spam repeated streaming markers. Do not hide failure/cancel details while run active. Do not require popup to understand current state.
- **Verification:** Plan for targeted running-state tests in `extensions/pi-gremlins/index.execute.test.js` and render snapshots in `extensions/pi-gremlins/index.render.test.js`.

### Task 2.3 — Improve usage readability, themed states, and narrow-width behavior

- **What:** Reformat usage stats into more scannable telemetry blocks; add themed empty/running/error states and discoverability hints; define embedded narrow-width degradation rules that preserve status, agent, active summary, and viewer hint with fewer separators and controlled clipping.
- **References:** `extensions/pi-gremlins/execution-shared.ts`, `extensions/pi-gremlins/result-rendering.ts`; PRD-0001 AC-7, AC-8, AC-9, AC-11; ADR-D1.
- **Acceptance criteria:** Usage data readable under load; empty/running/error states thematic and useful; narrow layouts keep core signal intact without broken wrapping or unreadable chrome.
- **Guardrails:** No footer telemetry wall. No hint spam when viewer unavailable. No layout logic that depends on accidental ANSI width behavior only.
- **Verification:** Plan for render tests that simulate dense usage, empty states, errors, and narrow-width strings in `extensions/pi-gremlins/index.render.test.js`.

### Phase 2 exit gate

- AC-2, AC-6, AC-7, AC-8, AC-9 materially satisfied for embedded surfaces.
- Embedded running UX readable without opening popup viewer.
- Single/parallel/chain embedded render snapshots updated and stable.

### Phase 2 risk controls

- Keep semantic helper imports central; do not fork status copy inside individual render branches.
- Use narrow-width fixture coverage before merging separator/layout reductions.
- Keep discoverability hint conditional on actual viewer snapshot availability.

---

## Phase 3 — Popup Viewer Chrome and Inspection Overhaul

### Milestone
Popup viewer becomes focused inspection surface with clearer hierarchy, stronger trust/status framing, better multi-result navigation, and semantic parity with embedded output.

### Primary files/components

- `extensions/pi-gremlins/index.ts`
- `extensions/pi-gremlins/viewer-result-navigation.ts`
- `extensions/pi-gremlins/viewer-open-action.ts`
- `extensions/pi-gremlins/execution-shared.ts`
- `extensions/pi-gremlins/index.viewer.test.js`
- `extensions/pi-gremlins/viewer-result-navigation.test.js`
- `extensions/pi-gremlins/viewer-open-action.test.js`

### Task 3.1 — Upgrade viewer chrome, metadata, and open affordance

- **What:** Redesign overlay header/chrome to foreground mode, invocation status, selected-result context, trust/source labels, and stronger result framing. Improve result context labels for chain/parallel. If viewer-open affordance copy, hint wording, or trigger behavior changes, update `viewer-open-action.ts` and its tests in same phase.
- **References:** `extensions/pi-gremlins/index.ts`, `extensions/pi-gremlins/viewer-result-navigation.ts`, `extensions/pi-gremlins/viewer-open-action.ts`, `extensions/pi-gremlins/viewer-open-action.test.js`; PRD-0001 AC-1, AC-5, AC-6, AC-8, AC-9; ADR-D2.
- **Acceptance criteria:** Viewer header no longer reads like generic transcript shell; mode/status/result context immediately visible; chain and parallel labels communicate progression/hierarchy clearly; any changed open-affordance copy or behavior has explicit regression coverage in `extensions/pi-gremlins/viewer-open-action.test.js`.
- **Guardrails:** No new overlay flow or persistence surface. No extra command complexity. Do not crowd header so much that body loses space on short terminals.
- **Verification:** Plan for `extensions/pi-gremlins/index.viewer.test.js`, `extensions/pi-gremlins/viewer-result-navigation.test.js`, and `extensions/pi-gremlins/viewer-open-action.test.js` assertions around chrome rows, context labels, navigation hints, discoverability/open-affordance copy, and open-action behavior.

### Task 3.2 — Rework viewer body lines, popup telemetry, and themed state variants

- **What:** Refine viewer body rendering so assistant text, tool calls, tool results, truncation, streaming, and errors have clearly differentiated line treatment; add clearer chain step progression and parallel sibling grouping cues; reduce separators; and make popup usage statistics plus popup empty/running/error states readable and semantically aligned with embedded output.
- **References:** `extensions/pi-gremlins/index.ts`, `extensions/pi-gremlins/execution-shared.ts`, `extensions/pi-gremlins/viewer-result-navigation.ts`; PRD-0001 AC-4, AC-5, AC-7, AC-8; ADR-D1, ADR-D2.
- **Acceptance criteria:** Viewer timeline/tree exposes chronology and hierarchy better than current flat list; truncation/error/streaming visible at glance; popup usage statistics stay scannable for turns, token flow, cache, context, cost, and model labels; popup empty/running/error states are themed, helpful, and consistent with embedded semantics.
- **Guardrails:** Do not invent persistent timeline/history concepts. Do not over-nest ASCII structure until narrow layouts break. No semantic drift from embedded badges/status names. No footer telemetry wall or discoverability-hint spam.
- **Verification:** Plan for `extensions/pi-gremlins/index.viewer.test.js` coverage of assistant text, tool calls/results, error result, truncated result, streaming assistant text, chain steps, parallel result selection, popup usage telemetry rows, and popup empty/running/error state variants.

### Task 3.3 — Harden reduced-height and narrow-width viewer behavior

- **What:** Tune chrome suppression, body height allocation, wrapping, clipping, and navigation hints for smaller terminals so essentials survive under height/width pressure. Ensure embedded and popup narrow behavior use same essential-information priority, including popup telemetry blocks and themed empty/running/error states.
- **References:** `extensions/pi-gremlins/viewer-result-navigation.ts`, `extensions/pi-gremlins/index.ts`; PRD-0001 AC-5, AC-7, AC-8, AC-9, AC-11; ADR-D2.
- **Acceptance criteria:** Small terminals preserve invocation status, result identity, current context, usage telemetry signal, and body readability; popup themed states remain legible; navigation hints appear only when useful; no broken chrome/body budget math.
- **Guardrails:** Do not regress existing overlay height invariants. Do not hide status to save chrome while keeping decorative elements.
- **Verification:** Plan for expanded `extensions/pi-gremlins/viewer-result-navigation.test.js` coverage across terminal sizes, plus `extensions/pi-gremlins/index.viewer.test.js` cases for narrow/short popup telemetry and popup empty/running/error layouts.

### Phase 3 exit gate

- AC-4, AC-5, AC-7, and popup-specific AC-8/AC-9 expectations materially satisfied in popup viewer.
- Popup usage telemetry readability plus popup themed empty/running/error states covered by automated viewer tests.
- Viewer chrome/body budget stable across narrow and short terminal states.
- Popup and embedded surfaces share same status vocabulary and trust/source semantics.
- If open-affordance copy or behavior changed, `extensions/pi-gremlins/viewer-open-action.test.js` covers it explicitly.

### Phase 3 risk controls

- Preserve `viewer-result-navigation.ts` invariants with explicit tests before body/chrome redesign lands.
- Keep result-context wording short; body space more valuable than ornate metadata.
- Separate chrome changes from body timeline changes when landing for easier rollback.

---

## Phase 4 — Cross-Surface Parity, Hardening, and Safe Polish

### Milestone
Both surfaces feel unified, regression-resistant, and complete. Optional polish lands only when semantics and readability already proven.

### Primary files/components

- `extensions/pi-gremlins/execution-shared.ts`
- `extensions/pi-gremlins/result-rendering.ts`
- `extensions/pi-gremlins/index.ts`
- `extensions/pi-gremlins/index.render.test.js`
- `extensions/pi-gremlins/index.viewer.test.js`
- `extensions/pi-gremlins/index.execute.test.js`
- `extensions/pi-gremlins/viewer-result-navigation.test.js`

### Task 4.1 — Remove remaining popup/embedded semantic drift

- **What:** Audit remaining ad hoc string/status/layout differences between embedded and popup surfaces. Consolidate repeated formatting into shared helpers where drift still exists. Remove obsolete branches and dead presentation code made unnecessary by Phases 1-3.
- **References:** `extensions/pi-gremlins/execution-shared.ts`, `extensions/pi-gremlins/result-rendering.ts`, `extensions/pi-gremlins/index.ts`; PRD-0001 AC-1, AC-3, AC-4, AC-11; ADR-D1, ADR-D2.
- **Acceptance criteria:** Same runtime state produces same status vocabulary, trust labels, and semantic distinctions across both surfaces; dead props/unused helpers from retired path removed; no-entry fallback rendering still produces correct summaries and state labels when `viewerEntries` are absent.
- **Guardrails:** No new abstraction layer unless duplication remains material. Do not remove fallback branch until no-entry states still covered.
- **Verification:** Plan for side-by-side snapshot assertions in `extensions/pi-gremlins/index.render.test.js` and `extensions/pi-gremlins/index.viewer.test.js` against same semantic fixture data, plus explicit no-entry fallback fixtures that must still render meaningful summaries after cleanup.

### Task 4.2 — Complete automated regression matrix and durable manual QA artifact

- **What:** Fill coverage gaps for running-state semantics, `viewerEntries`-driven summaries, responsive behavior, trust/source surfacing, themed states, and popup navigation. Maintain final manual QA matrix as durable repo artifact in `docs/plans/pi-gremlins-immersive-theming-viewer-ux-overhaul.md`, Appendix A.
- **References:** `extensions/pi-gremlins/index.render.test.js`, `extensions/pi-gremlins/index.viewer.test.js`, `extensions/pi-gremlins/index.execute.test.js`, `extensions/pi-gremlins/viewer-result-navigation.test.js`, `extensions/pi-gremlins/viewer-open-action.test.js`, `docs/plans/pi-gremlins-immersive-theming-viewer-ux-overhaul.md` Appendix A; PRD-0001 AC-11; ADR verification section.
- **Acceptance criteria:** Test suite explicitly covers all PRD acceptance buckets; durable manual QA artifact exists at Appendix A of this plan with explicit scenario IDs and expected signals; no critical scenario left to implicit testing.
- **Guardrails:** No vague “spot check” verification. Every critical path needs deterministic automated or explicit manual check.
- **Verification:** Plan for `npm run typecheck`, `npm test`, and Appendix A scenarios QA-01 through QA-14, including single/parallel/chain live run, failure, cancellation, truncation, popup state variants, narrow width, short height, viewer open/refocus, and no-persistence checks.

### Task 4.3 — Apply restrained personality and optional safe motion pass

- **What:** Add final thematic polish only after parity and regression gates pass: restrained gremlin flavor, improved copy cadence, subtle live affordance or motion only if static fallback remains equally clear and tests remain stable. If motion fails safety/readability bar, defer it.
- **References:** `extensions/pi-gremlins/result-rendering.ts`, `extensions/pi-gremlins/index.ts`; PRD-0001 UX Notes, AC-8, AC-9; ADR-D3.
- **Acceptance criteria:** Final UI feels distinctive without noise; any motion is optional-in-effect and removable with zero semantic loss; static state remains first-class.
- **Guardrails:** No animation-first design. No test fragility from timing-sensitive rendering. No personality copy that hides trust/status signal.
- **Verification:** Plan for final snapshot update review plus manual QA across running/completed/error states with and without active streaming.

### Phase 4 exit gate

- AC-1 through AC-11 satisfied end-to-end.
- No persistence/history surface introduced.
- Dead presentation code removed.
- Final UX consistent across embedded and popup surfaces.
- Fallback message-derived rendering still passes explicit no-entry regression coverage after cleanup.

### Phase 4 risk controls

- Treat motion as expendable. If unsafe, cut it before release.
- Land cleanup only after parity snapshots stable.
- Require dead-code check for unused helpers/exports introduced during earlier phases.

---

## Phase Milestones Summary

| Phase | Milestone | Depends on | Exit proof |
| --- | --- | --- | --- |
| 1 | Shared semantic presentation contract; `viewerEntries` canonical when present | None | State/projection tests green; no persistence drift |
| 2 | Embedded surface redesigned for live clarity and narrow readability | Phase 1 | Embedded snapshots cover live/completed/error/narrow cases |
| 3 | Popup viewer upgraded with semantic timeline/tree and adaptive chrome | Phases 1-2 | Viewer chrome/body tests green across terminal sizes |
| 4 | Cross-surface parity, regression hardening, restrained polish complete | Phases 2-3 | Full `npm run typecheck` + `npm test` + manual QA matrix |

## Verification Strategy by Phase

### Automated verification plan

- **Phase 1:** Targeted semantic/data-path tests in `index.execute.test.js`, `index.render.test.js`, `index.viewer.test.js`.
- **Phase 2:** Render snapshots for single/parallel/chain collapsed/expanded/live/error/narrow scenarios.
- **Phase 3:** Viewer overlay and navigation tests in `index.viewer.test.js`, `viewer-result-navigation.test.js`, plus `viewer-open-action.test.js` when open-affordance copy or behavior changes.
- **Phase 4:** Full regression: `npm run typecheck`, `npm test`.

### Manual verification plan

Use Appendix A — Durable Manual QA Matrix in this plan as execution-time manual QA artifact. Every scenario there must be checked against same session-local architecture and recorded with pass/fail evidence during implementation review.

## Rollback Strategy

- Land phases in isolated commits/PR slices. Revert per phase, not whole initiative.
- If Phase 2 regresses embedded readability, roll back `result-rendering.ts` changes while keeping Phase 1 semantic helpers and tests.
- If Phase 3 regresses overlay behavior, roll back `viewer-result-navigation.ts` and viewer chrome/body changes while preserving Phase 1-2 embedded improvements.
- Keep fallback message-derived rendering until Phase 4 parity gate passes. That gives immediate safety valve if `viewerEntries` presentation regresses.
- Treat motion/polish as last-in and first-out. Drop it with zero functional impact if stability slips.

## Major Risks and Controls

### Risk 1 — Semantic drift between popup and embedded returns during implementation
- **Impact:** Fails ADR-0001 and PRD AC-1/AC-3/AC-4.
- **Control:** Centralize status/trust/usage vocabulary in `execution-shared.ts`; add side-by-side fixture tests in Phase 4.

### Risk 2 — Running-state UX lies during partial updates
- **Impact:** Operators misread active work or failure state.
- **Control:** Fix state derivation first in Phase 1; test partial parallel completion and chain interruption before any chrome polish.

### Risk 3 — Narrow layouts collapse into unreadable noise
- **Impact:** Fails PRD AC-9; highest-value operator contexts degrade.
- **Control:** Explicit width/height degradation rules in Phases 2 and 3; terminal-size tests before merge.

### Risk 4 — Trust/source surfacing overwhelms primary content
- **Impact:** Higher cognitive load; lower scan speed.
- **Control:** Put source/trust into badges/context rows first; repeat only where interpretation materially changes.

### Risk 5 — Optional motion harms readability or test stability
- **Impact:** Late regressions, noisy UX.
- **Control:** Motion only in Phase 4; static fallback mandatory; defer entirely if unsafe.

## Deferred Items / Non-Goals

- Persistence, searchable history, archives, dashboards, cross-session recall.
- Backend/API/storage/config changes.
- Broad Pi rebrand or extension work outside `extensions/pi-gremlins`.
- Trust-policy redesign beyond clearer surfacing of existing origin semantics.
- Heavy animation. If subtle motion cannot meet safety bar, defer it fully.
- Upstream Pi theming primitive changes outside this package unless later justified by separate scope/ADR.

## Open Risks / Unknowns to Resolve During Execution

- Minimum essential information set for ultra-narrow embedded layout: likely status + identity + one active summary + viewer hint, but execution should validate.
- Exact density tier for trust/source cues in multi-result rows: badge in summary row may suffice; repeating per child may be excessive.
- Whether current TUI environment can support any live affordance beyond static badges without hurting tests/readability.

## Recommended Execution Order

1. Phase 1 Task 1.1
2. Phase 1 Task 1.2
3. Phase 1 Task 1.3
4. Phase 2 Task 2.1
5. Phase 2 Task 2.2
6. Phase 2 Task 2.3
7. Phase 3 Task 3.1
8. Phase 3 Task 3.2
9. Phase 3 Task 3.3
10. Phase 4 Task 4.1
11. Phase 4 Task 4.2
12. Phase 4 Task 4.3

## Appendix A — Durable Manual QA Matrix

| ID | Scenario | Surface(s) | Expected signals |
| --- | --- | --- | --- |
| QA-01 | Single run, live to completion | Embedded + popup | Embedded shows explicit running badge plus active step/tool focus before completion; popup shows matching status vocabulary, differentiated tool/assistant lines, then completed state without semantic drift. |
| QA-02 | Single run failure and cancellation | Embedded + popup | Failed and canceled remain distinct labels/badges; error details visible; canceled state never collapsed into failed; popup error state themed and helpful. |
| QA-03 | Parallel run mixed states | Embedded + popup | Active child obvious while siblings show pending/completed/failed correctly; popup result switching preserves sibling context and progression labels. |
| QA-04 | Chain run progression and stop-on-failure | Embedded + popup | Sequential step context readable; current step obvious while running; stop-on-failure leaves later steps not falsely completed; popup hierarchy matches embedded summary. |
| QA-05 | `viewerEntries` present path | Embedded + popup | Embedded summaries follow `viewerEntries` semantics for tool calls, tool results, truncation, streaming, and errors; popup and embedded wording stay aligned. |
| QA-06 | No-entry fallback path | Embedded + popup | Message-derived fallback still renders meaningful summary/status when `viewerEntries` absent; no blank or broken state after Phase 4 cleanup. |
| QA-07 | Popup empty state | Popup | Empty viewer state uses themed helpful copy, no broken chrome, and discoverability guidance only when relevant. |
| QA-08 | Popup running state | Popup | Running viewer state shows current activity, readable telemetry, and no generic transcript feel; body and chrome both remain legible during live updates. |
| QA-09 | Popup error state | Popup | Error viewer state clearly distinguished from normal completion, preserves trust/source cues, and keeps next-step/help text readable. |
| QA-10 | Usage telemetry readability under load | Embedded + popup | Turns, token flow, cache, context, cost, and model labels remain scannable; telemetry reads as compact signal, not footer wall. |
| QA-11 | Narrow-width embedded layout | Embedded | Status, identity, active summary, and viewer hint survive width pressure with controlled clipping and reduced separator noise. |
| QA-12 | Reduced-height / narrow popup layout | Popup | Status, result identity, context, telemetry signal, and navigation hints remain usable; chrome/body budget does not break on short terminals. |
| QA-13 | Viewer open/refocus affordance | Embedded + popup | Discoverability hint appears only when relevant; changed open-affordance copy/behavior matches `viewer-open-action.test.js`; open/refocus path lands on correct viewer context. |
| QA-14 | No persistence/history regression | Embedded + popup | No saved history, archive, or cross-session surface appears; all behavior remains session-local and extension-only. |

### Appendix A Execution Evidence — 2026-04-21

- **Environment:** Automated verification in current repo checkout. No interactive manual TUI session recorded in this environment.
- **Verification commands:**
  - `npm test -- extensions/pi-gremlins/index.render.test.js extensions/pi-gremlins/index.viewer.test.js extensions/pi-gremlins/index.execute.test.js extensions/pi-gremlins/viewer-result-navigation.test.js` ✅ pass
  - `npm test -- extensions/pi-gremlins` ✅ pass
  - `npm run typecheck` ✅ pass
  - `fff_multi_grep` on `extensions/pi-gremlins` for `localStorage`, `sessionStorage`, `indexedDB`, `archive`, `cross-session`, `history` ✅ no matches

| ID | Result | Evidence | Notes |
| --- | --- | --- | --- |
| QA-01 | PASS | `index.execute.test.js` → `single mode streams running updates before final result`; `index.viewer.test.js` → `aligns running no-entry tool-call-only fallback semantics across embedded and popup` | Single live semantics exercised in automated snapshot flow. |
| QA-02 | PASS | `index.execute.test.js` → `treats aborted pending results as canceled instead of running`, `single mode returns explicit canceled terminal text`; `index.viewer.test.js` → `preserves canceled popup semantics in fallback body state`, `renders popup error state with semantic failure copy` | Failed vs canceled kept distinct. |
| QA-03 | PASS | `index.execute.test.js` → `parallel mode streams initial pending state, per-task progress, and final aggregate details`, `parallel mode reports canceled children without labeling them failed`; `index.render.test.js` → `renders parallel running state with active row and readable aggregate usage` | Mixed-state parallel progress and aggregate status covered. |
| QA-04 | PASS | `index.execute.test.js` → `chain mode emits pending snapshots, previous substitution, and stops on error`, `chain mode carries forward viewer-entry output and stops on canceled results`; `index.render.test.js` → `renders chain running and canceled states with semantic badges instead of failure markers` | Chain progression and stop-on-failure covered. |
| QA-05 | PASS | `index.render.test.js` → `treats viewerEntries as canonical embedded feed when present and does not render running as failure`; `index.viewer.test.js` → `renders popup body with differentiated assistant tool and error lines` | `viewerEntries` path verified across both surfaces. |
| QA-06 | PASS | `index.viewer.test.js` → `retains popup fallback body lines when viewer entries are absent`, `aligns completed no-entry tool-call-only fallback semantics across embedded and popup`, `aligns running no-entry tool-call-only fallback semantics across embedded and popup`; `index.render.test.js` → `keeps no-entry tool-call-only single summaries terminal-safe and running-live` | Phase 4 blocker-specific fallback parity evidence. |
| QA-07 | PASS | `index.viewer.test.js` → `renders popup empty state with themed idle telemetry` | Empty viewer chrome/body state covered. |
| QA-08 | PASS | `index.viewer.test.js` → `renders popup running state before first viewer entry arrives`, `aligns running no-entry tool-call-only fallback semantics across embedded and popup` | Running popup state covered before and after semantic content exists. |
| QA-09 | PASS | `index.viewer.test.js` → `renders popup error state with semantic failure copy`, `keeps embedded and popup fallback vocabulary aligned for failed project results without viewer entries` | Error presentation and trust/source cues covered. |
| QA-10 | PASS | `index.render.test.js` → `renders single collapsed summary as status-first digest with readable usage and local expand hint`, `renders parallel running state with active row and readable aggregate usage`; `index.viewer.test.js` → `renders mission-control chrome with focused mixed-model telemetry visible` | Usage labels verified embedded + popup. |
| QA-11 | PASS | `index.render.test.js` → `compresses single embedded summary deterministically at narrow width`, `compresses chain embedded summary deterministically at narrow width`, `compresses parallel embedded summary deterministically at narrow width` | Embedded narrow-width degradation covered. |
| QA-12 | PASS | `index.viewer.test.js` → `renders popup narrow-width layout with essential chrome only`, `renders popup short-height layout with body retained after chrome suppression`; `viewer-result-navigation.test.js` → `keeps rendered chrome and body within overlay height budget for all terminal sizes` | Popup narrow/short layout budget covered. |
| QA-13 | PASS | `viewer-open-action.test.js` → `opens new viewer when no runtime exists`, `focuses existing overlay when handle already attached`; `index.viewer.test.js` → `focuses existing overlay instead of opening duplicate viewer` | Open/refocus affordance and duplicate-open prevention covered. |
| QA-14 | PASS | `fff_multi_grep` on `extensions/pi-gremlins` for persistence/history primitives returned no matches; all verified tests exercised session-local snapshot/update flow only | No persistence/history surface observed in repo-local extension scope. |

## Self-Review Checklist

- [x] One plan file only under `docs/plans/`
- [x] Phased by dependency and risk
- [x] References PRD-0001 and ADR-0001 explicitly
- [x] Includes milestones, tasks, touched files/components, verification, risk controls, rollback, deferred items
- [x] Keeps scope inside session-local `extensions/pi-gremlins`
- [x] No implementation performed in this plan
