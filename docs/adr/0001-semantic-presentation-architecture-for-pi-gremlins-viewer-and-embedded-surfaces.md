# ADR-0001: Semantic Presentation Architecture for Pi Gremlins Viewer and Embedded Surfaces

- **Status:** Accepted
- **Date:** 2026-04-21
- **Decision Maker:** Magi Metal
- **Related:** `README.md`, `CHANGELOG.md`, `extensions/pi-gremlins/index.ts`, `extensions/pi-gremlins/execution-shared.ts`, `extensions/pi-gremlins/result-rendering.ts`, `docs/prd/0001-pi-gremlins-immersive-theming-and-viewer-ux-overhaul.md` (PRD-0001)
- **Supersedes:** none

## Context

`pi-gremlins` already renders one invocation through two distinct presentation paths inside `extensions/pi-gremlins`:

- Embedded tool rendering derives display content from `result.messages` via `getDerivedRenderData()` in `extensions/pi-gremlins/execution-shared.ts` and `renderPiGremlinsResult()` in `extensions/pi-gremlins/result-rendering.ts`.
- Popup viewer rendering projects child process events into `result.viewerEntries` via `applyChildEventToSingleResult()` in `extensions/pi-gremlins/index.ts`, then renders those projected entries in the overlay body.

Planned UX/theming/viewer work is explicitly limited to session-local extension behavior. It must not introduce persistence, history storage, or a new cross-session data model. Even with that limit, standardizing both embedded and popup surfaces around one semantic presentation layer and one shared `viewerEntries`-driven event projection changes which runtime model is authoritative for user-visible gremlin output.

Without an explicit decision record, future work would need to rediscover why the package chose one canonical presentation model instead of continuing with split render pipelines or expanding into a heavier viewer/history subsystem.

## Decision Drivers

- Keep embedded and popup surfaces consistent for assistant text, tool-call previews, streaming states, truncation, and error rendering.
- Reduce duplicated presentation logic currently split between message-derived rendering and viewer-entry-derived rendering.
- Preserve current session-local architecture. No persistence, history, or config format changes in this initiative.
- Improve maintainability and testability for UX/theming/viewer work that spans both surfaces.

## Options Considered

### Option A: Keep split render pipelines

- Pros: Smallest local change for isolated UI polish; no new shared presentation contract.
- Cons: Preserves two authoritative render inputs (`messages` for embedded, `viewerEntries` for popup); increases drift risk between surfaces; makes theming and behavior parity harder to verify.

### Option B: Standardize on shared semantic presentation layer backed by `viewerEntries` event projection

- Pros: Creates one canonical runtime presentation model for both surfaces; centralizes streaming/tool/result semantics; makes UX/theming changes reusable across embedded and popup renderers; stays inside session-local boundaries.
- Cons: Requires refactoring current embedded renderer away from direct `messages`-only derivation; introduces a more explicit internal presentation subsystem that must stay well-tested.

### Option C: Build a broader viewer/history subsystem with persisted runs

- Pros: Could support richer inspection, cross-session recall, and future analytics.
- Cons: Violates current initiative boundary; adds persistence and migration concerns; materially expands scope beyond UX/theming/viewer improvements.

## Decision

Chosen: **Option B: Standardize on shared semantic presentation layer backed by `viewerEntries` event projection**.

Rationale: This initiative is no longer only styling or isolated viewer polish once both embedded and popup surfaces are required to present the same runtime semantics through a shared layer. That introduces an internal subsystem boundary and alters runtime presentation architecture inside the extension. Recording the decision now prevents accidental drift into split pipelines or persistence-heavy scope later.

## Consequences

- **Positive:** One canonical semantic model for gremlin output; clearer renderer responsibilities; easier parity between inline and popup experiences; theming work can target stable semantic roles instead of surface-specific formatting.
- **Negative:** Existing rendering code must be reorganized around shared projection/presentation helpers; regressions become possible if embedded rendering still depends on `messages` in parallel with `viewerEntries`.
- **Follow-on constraints:** Future UX work in `extensions/pi-gremlins` should treat session-local projected viewer data as source of truth for presentation. Persistence/history remains out of scope unless justified by a separate ADR.

## Implementation Impact

- **apps/api:** N/A. Repository is standalone Pi extension package, not an `apps/api` workspace.
- **apps/web:** N/A. No web frontend package in this repository.
- **packages/shared:** N/A. No shared workspace package change required.
- **packages/utils:** N/A. No standalone utils package change required.
- **Migration/ops:** No persistence migration, config format change, or deploy pipeline change. Runtime impact limited to extension-local event projection and rendering paths under `extensions/pi-gremlins/`.

## Verification

- **Automated:** `npm run typecheck`; `npm test`; add or update tests covering shared projection/rendering behavior for single, parallel, and chain results across embedded rendering and `/pi-gremlins:view` popup flows.
- **Manual:** Run representative single, parallel, and chain gremlin invocations; compare embedded output and popup lair output for tool calls, streaming text, truncated tool results, error states, and navigation context; confirm no cross-session history or persistence artifacts are introduced.

## Notes

This ADR is justified by trigger rubric because planned work introduces an explicit semantic presentation subsystem and changes runtime presentation architecture, even though it stays inside one package and preserves session-local boundaries. If later work adds persistence, history, config shape changes, or a new viewer storage model, that requires separate ADR evaluation instead of extending this record by implication.

## Status History

- 2026-04-21: Accepted
