# PRD-0001: Pi Gremlins Immersive Theming and Viewer UX Overhaul

- **Status:** Completed
- **Date:** 2026-04-21
- **Author:** Magi Metal
- **Related:** `extensions/pi-gremlins`, `/gremlins:view`, `README.md`, `docs/adr/0001-semantic-presentation-architecture-for-pi-gremlins-viewer-and-embedded-surfaces.md` (ADR-0001)
- **Supersedes:** None

## Problem Statement

`pi-gremlins` already delivers isolated subagent execution, session-local snapshots, embedded result rendering, and popup viewer inspection. Current UX still feels fragmented across collapsed inline output, expanded render states, and popup lair chrome. Running-state semantics are harder to trust than they should be, source/provenance cues are too easy to miss, usage stats are low-signal under load, and live tool activity is not surfaced consistently between embedded and popup experiences.

This work targets people actively dispatching single, parallel, and chain gremlin runs inside Pi sessions. They need to answer simple questions fast: what is running, what finished, what failed, where output came from, which action is currently active, and whether they should open viewer for deeper inspection. Without one scoped PRD, implementation risk is high because previously researched recommendations span theming, runtime state presentation, information hierarchy, compact density behavior, and popup viewer ergonomics. Scope must stay constrained to `extensions/pi-gremlins` and preserve current session-local architecture.

## Product Goals

- Create one cohesive pi-gremlins visual language across embedded render states and popup viewer.
- Make live execution status, active work, and terminal outcomes immediately legible for single, parallel, and chain modes.
- Surface trust and provenance clearly, especially agent source and project-agent participation.
- Upgrade popup viewer from raw transcript shell into focused inspection surface without turning it into persistent history product.
- Reuse existing `viewerEntries` as canonical viewer/embedded semantic feed where feasible.
- Preserve restrained gremlin personality: immersive, distinctive, not noisy.

## User Stories

- As an operator running gremlins, I want immediate status and active-step clarity so that I can monitor progress without reading every line.
- As an operator reviewing tool activity, I want inline summaries and richer viewer timelines so that I can inspect work without losing context.
- As a cautious user, I want source and trust cues for each gremlin result so that I understand whether output came from user, project, package, or unknown agent origins.
- As a user in a narrow terminal or constrained pane, I want critical status and summaries to remain readable so that viewer value does not collapse on smaller layouts.
- As a user discovering the feature, I want embedded hints and themed empty/running/error states so that viewer and status behavior feel understandable without external docs.

## Scope

### In Scope

- Semantic style layer for pi-gremlins UI states, badges, labels, separators, and themed empty/running/error treatments.
- Shared semantic presentation between embedded render output and popup viewer, including reduced separator noise and consistent state vocabulary.
- Mode-specific identity cues for single, parallel, and chain invocations inside shared theme system.
- Popup viewer chrome upgrade: stronger header, clearer mode/status framing, better result context labeling, more legible navigation affordances.
- Embedded collapsed-summary redesign focused on scannability during live and completed runs.
- Explicit status badges for invocation state and child result state.
- Source/trust surfacing for agent origin and project-agent participation where it changes user trust decisions.
- Timeline/tree improvements for chain and parallel result inspection.
- Usage-stat readability improvements for inline and viewer surfaces.
- Adaptive narrow-width behavior for embedded and viewer output.
- Themed discoverability hints, especially around `/gremlins:view`.
- Subtle motion or live affordance polish only if current TUI/runtime makes it safe, readable, and optional.
- Embedded running-actions enhancements: active action row, inline tool-result summaries, compact-live density tier.
- Running-state semantics fix so active, pending, completed, failed, and canceled states are presented accurately.
- Viewer and embedded semantic unification driven by existing `viewerEntries` rather than divergent ad hoc derivations when viewer data exists.

### Out of Scope / Non-Goals

- Any persistence, cross-session history, dashboard, archive, or searchable run-history productization.
- Any architecture change that replaces current session-local snapshot model.
- Changes outside `extensions/pi-gremlins` except docs/index references required by PRD workflow.
- New backend, API, database, or storage work.
- Broad agent-management, agent-authoring, or trust-policy redesign beyond surfacing current semantics more clearly.
- Rebranding Pi broadly or adding high-noise decorative theming unrelated to operator comprehension.

## Acceptance Criteria

- [x] Embedded and popup pi-gremlins surfaces use one shared semantic vocabulary for `Running`, `Completed`, `Failed`, and `Canceled`, with explicit badges or labels that do not rely on color alone.
- [x] While a run is active, embedded rendering makes current activity obvious, including an active row or equivalent live focus for running task/step/tool activity.
- [x] When `viewerEntries` exist for a result, embedded rendering consumes that semantic feed for live and completed summaries instead of depending only on message-derived final output.
- [x] Popup viewer renders assistant text, tool calls, tool results, streaming states, truncation, and errors with clearly differentiated presentation and reduced separator clutter.
- [x] Parallel and chain views surface hierarchy/progression more clearly than current flat presentation, including per-result context that remains readable at narrow sizes.
- [x] Agent source and trust-relevant context are visible wherever user interpretation meaningfully changes, including project-agent participation and agent origin labels.
- [x] Usage statistics remain visible but scannable, with improved readability for turns, token flow, cache use, context, cost, and model labels when present.
- [x] Empty, running, and error states are themed, helpful, and consistent across inline and popup surfaces, including discoverability hints for opening viewer when relevant.
- [x] Narrow-width and reduced-height layouts preserve status, identity, current activity, and summary readability without broken wrapping or unusable chrome.
- [x] No persistence, history storage, or new cross-session surfaces are introduced anywhere in implementation.
- [x] Automated coverage exists for updated result rendering, popup viewer behavior, running-state semantics, `viewerEntries`-driven summaries, and responsive/narrow-state behavior within `extensions/pi-gremlins` tests.

## Technical Surface

- **`extensions/pi-gremlins/execution-shared.ts`:** Canonical invocation/result status semantics, `viewerEntries` types, usage formatting, and shared render data contracts. Preserve session-local model. Do not introduce persistence primitives.
- **`extensions/pi-gremlins/result-rendering.ts`:** Embedded collapsed/expanded rendering, live density tiers, status badges, inline tool-result summaries, discoverability hints, and usage readability improvements.
- **`extensions/pi-gremlins/index.ts`:** Viewer snapshot creation, popup overlay body assembly, viewer chrome content, result selection context, running update semantics, and popup/embedded semantic unification.
- **`extensions/pi-gremlins/viewer-result-navigation.ts`:** Narrow-layout chrome rules, result context labels, navigation hint behavior, and sizing policies for viewer overlay.
- **`extensions/pi-gremlins/viewer-open-action.ts`:** Viewer launch/open affordance updates if labels or trigger copy change.
- **`extensions/pi-gremlins/*.test.js`:** Regression coverage for viewer snapshots, rendering output, status semantics, trust/source surfacing, and layout fallback behavior.
- **Related ADRs:** ADR-0001 — `docs/adr/0001-semantic-presentation-architecture-for-pi-gremlins-viewer-and-embedded-surfaces.md`. If implementation later requires additional architectural change beyond current session-local model, add a new ADR separately and cross-link back to this PRD.

## UX Notes

- Use semantic styling first, decorative styling second. Operator comprehension beats novelty.
- Keep gremlin personality restrained: distinctive header/copy acceptable, clutter and theatrical chrome not acceptable.
- Different invocation modes should feel related but not identical. Single, parallel, and chain each need fast-recognition identity cues.
- Popup viewer should feel like focused inspection surface, not generic bordered transcript dump.
- Embedded summaries should bias toward fast scan: status first, identity second, current activity third, then short meaningful content.
- Parallel and chain structures should visually communicate sibling-vs-sequential relationships rather than treating all outputs as same-shape lists.
- Source/trust surfacing must be explicit enough for safety decisions but concise enough to avoid drowning primary task/output information.
- Usage stats should read as compact telemetry, not footer noise.
- Narrow layouts must degrade intentionally: fewer separators, denser badges, clipped summaries, preserved essentials.
- Motion, if used at all, must stay subtle, optional by nature, and safe for terminal rendering. Static fallback required.

## Rollout / Sequencing Notes

1. **Semantic foundation first.** Normalize shared status language, badge model, and `viewerEntries` consumption strategy before visual restyling.
2. **Running-state correctness second.** Fix active/pending/completed semantics and expose active row behavior before broader chrome polish.
3. **Embedded live readability third.** Redesign collapsed summaries, inline tool-result summaries, compact-live density, and usage-stat readability.
4. **Popup viewer overhaul fourth.** Upgrade header/context chrome, timeline/tree cues, themed empty/running/error states, and narrow-layout behavior.
5. **Polish last.** Add discoverability hints, restrained personality details, and subtle motion only after semantic/readability goals are proven.

## Open Questions

- Should semantic styling live as small local helpers inside `extensions/pi-gremlins` or piggyback more directly on upstream Pi theme primitives already available to extension renderers?
- What is minimum acceptable information set for ultra-narrow embedded layouts: status + agent + one live summary line, or status + active tool + viewer hint?
- Can subtle motion be delivered safely in current TUI environment without harming readability, accessibility, or test stability?
- Does source/trust surfacing belong on every child result row, only in viewer chrome, or both with different density tiers?

## Completion Summary

Implemented within `extensions/pi-gremlins` only. Delivered shared semantic presentation across embedded and popup surfaces, made `viewerEntries` canonical when present, corrected running/canceled/failed semantics, redesigned embedded compact-live output with active-row and tool-result summaries, upgraded popup viewer chrome and semantic timeline readability, hardened narrow-width and short-height behavior, preserved fallback/no-entry parity, and recorded QA evidence in plan Appendix A.

Intentional deferral: optional motion enhancement was evaluated as unsafe/unproven under current TUI constraints and deferred deliberately rather than omitted accidentally. No persistence, cross-session history, or broader Pi surface expansion was introduced.

## Revision History

- 2026-04-21: Draft created
- 2026-04-21: Draft refined for implementation planning; clarified non-goals wording for extension-only scope.
- 2026-04-21: Marked Completed after implementation shipped across `extensions/pi-gremlins`; recorded completion summary, preserved ADR cross-link, and noted intentional deferral of optional motion under current TUI constraints.
