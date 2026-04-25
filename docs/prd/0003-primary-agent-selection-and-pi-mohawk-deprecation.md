# PRD-0003: Primary Agent Selection and pi-mohawk Deprecation

- **Status:** Completed
- **Date:** 2026-04-25
- **Author:** Magi Metal
- **Related:** `extensions/pi-gremlins`, `README.md`, `CHANGELOG.md`, GitHub issue [#39](https://github.com/magimetal/pi-gremlins/issues/39), [ADR-0003](../adr/0003-unified-agent-discovery-and-primary-agent-prompt-injection-in-pi-gremlins.md)
- **Supersedes:** None

## Problem Statement

`pi-mohawk` currently owns primary-agent selection, session state, command/shortcut UX, and system-prompt injection while `pi-gremlins` owns sub-agent delegation. Users who want both behaviors must install and reason about two separate packages even though both discover markdown agent definitions from the same user/project locations and both model agent roles with frontmatter.

Issue #39 asks to deprecate `pi-mohawk` by moving primary-agent functionality into `pi-gremlins`. This is a user-facing package scope expansion: `pi-gremlins` becomes the combined agent-orchestration package for selecting one primary agent for the parent session and dispatching gremlin sub-agents for delegated work. Scope must protect the existing v1 gremlin tool contract while adding a compatible primary-agent path that gives current `pi-mohawk` users a clear migration target.

## Product Goals

- Make `pi-gremlins` the single install/runtime package for primary-agent selection plus gremlin delegation.
- Preserve the existing `pi-gremlins` machine-facing package, extension, and tool identity.
- Provide primary-agent controls that cover selection, clearing, cycling, status visibility, session reconstruction, and prompt injection.
- Keep primary-agent and sub-agent roles strictly separated by `agent_type` frontmatter.
- Give `pi-mohawk` users a compatibility path before documenting deprecation of the separate package.
- Maintain v1 gremlin behavior and request schema while adding primary-agent support beside it.

## User Stories

- As an operator, I want to select a primary agent inside `pi-gremlins` so that the parent assistant follows a chosen role without installing `pi-mohawk`.
- As an existing `pi-mohawk` user, I want familiar `/mohawk` and shortcut behavior to keep working during migration so that existing muscle memory is not broken immediately.
- As an operator, I want selected primary-agent state to survive current-session branch reconstruction so that prompt behavior remains predictable across session events.
- As a cautious user, I want primary agents and gremlin sub-agents separated by `agent_type` so that prompt-injected roles cannot accidentally be summoned as delegated gremlins, and gremlins cannot become primary agents.
- As a maintainer, I want shared discovery/parsing where practical so that user/project precedence, markdown parsing, and typed role filtering do not diverge across two implementations.
- As a package user, I want deprecation guidance for `pi-mohawk` only after equivalent behavior exists in `pi-gremlins` so that migration does not strand active workflows.

## Scope

### In Scope

- Add primary-agent discovery to `pi-gremlins` from user-level `~/.pi/agent/agents/*.md` and nearest project `.pi/agents/*.md`.
- Load selectable primary agents only from markdown files with `agent_type: primary`.
- Preserve existing gremlin discovery for markdown files with `agent_type: sub-agent`.
- Share agent definition parsing/discovery internals where practical while preserving strict role separation.
- Resolve duplicate display names with nearest project definition taking precedence over user-level definition for typed primary agents.
- Support exact and unambiguous case-insensitive primary-agent selection, with ambiguous case-insensitive matches rejected without changing state.
- Add session-scoped selected primary-agent state in `pi-gremlins`, persisted as minimal identity data rather than raw markdown.
- Add `before_agent_start` prompt injection for the selected primary agent using a clear delimited block.
- Add user controls for selecting, clearing, listing/picking, and cycling primary agents.
- Preserve or intentionally alias familiar `pi-mohawk` UX where accepted by design: `/mohawk`, `/mohawk <name>`, `/mohawk none`, `ctrl+shift+m`, and `Primary: <name|None>` status semantics.
- Update `pi-gremlins` README and changelog with primary-agent behavior, migration notes, and PRD/ADR references.
- After equivalent `pi-gremlins` behavior lands, update `pi-mohawk` documentation to mark that package deprecated and point users to `pi-gremlins`.
- Port relevant `pi-mohawk` coverage into Bun tests under `extensions/pi-gremlins`.

### Out of Scope / Non-Goals

- Changing the `pi-gremlins` tool schema for gremlin delegation.
- Renaming machine-facing package, extension, tool, schema, or runtime identifiers away from `pi-gremlins`.
- Reintroducing chain mode, popup viewer, `/gremlins:view`, targeted steering, package gremlin discovery, or scope toggles.
- Editing, creating, or deleting agent markdown definitions from the extension.
- Loading untyped, malformed, or legacy-role markdown as primary agents or gremlins.
- Persisting raw primary-agent markdown in session entries.
- Persisting selected primary agent across unrelated new Pi sessions unless a later PRD explicitly expands scope.
- Deprecating or telling users to uninstall `pi-mohawk` before `pi-gremlins` contains equivalent primary-agent behavior.
- Pulling `pi-mohawk` package code wholesale without adapting to `pi-gremlins` runtime and test conventions.

## Acceptance Criteria

- [x] `pi-gremlins` discovers primary-agent markdown from user-level and nearest project agent directories only when frontmatter contains `agent_type: primary`.
- [x] Existing gremlin discovery continues to load only `agent_type: sub-agent` definitions and the public gremlin request schema remains unchanged.
- [x] Primary-agent and sub-agent definitions cannot cross roles: primary agents are not summonable as gremlins, and sub-agents are not selectable as primary agents.
- [x] Duplicate primary-agent display names resolve deterministically with nearest project definition winning over user-level definition.
- [x] Primary-agent display name fallback order matches existing `pi-mohawk` behavior: frontmatter `name`, first H1, then filename stem.
- [x] Exact primary-agent command selection works.
- [x] A single unambiguous case-insensitive primary-agent command selection works.
- [x] Ambiguous case-insensitive primary-agent command selection leaves state unchanged and reports exact-case options.
- [x] Clearing selection to `None` works through command UX and shortcut cycle state.
- [x] No-argument command opens a picker when UI support exists.
- [x] No-argument command without UI support emits a transcript-visible list of available primary agents.
- [x] Shortcut cycling moves deterministically through `[None, ...sorted primary agents]`.
- [x] Status UI reflects `Primary: <name|None>` after session start and after every primary-agent selection change.
- [x] Selected primary-agent state is reconstructed from current-branch session entries.
- [x] Session persistence stores minimal selected identity data and never stores raw markdown.
- [x] Missing selected primary agent resets to `None`, warns the user, and avoids prompt injection.
- [x] If legacy `pi-mohawk-primary-agent` session entries are supported by the final ADR, they are read for migration but new writes use a `pi-gremlins`-owned entry type.
- [x] Selecting `None` leaves the parent system prompt unchanged.
- [x] Selecting a primary agent appends its raw markdown inside a `pi-gremlins`-owned delimited block during `before_agent_start`.
- [x] Repeated prompt injection does not duplicate the primary-agent block.
- [x] Prompt injection never injects sub-agent markdown.
- [x] README documents both roles: `agent_type: primary` for parent-session prompt control and `agent_type: sub-agent` for gremlin delegation.
- [x] README documents implemented command names, shortcut behavior, status behavior, session scope, and `pi-mohawk` migration guidance.
- [x] CHANGELOG references PRD-0003 and the related ADR for this scope.
- [x] `pi-mohawk` deprecation documentation is updated only after equivalent `pi-gremlins` primary-agent behavior ships.
- [x] Automated Bun coverage exists for primary-agent definition loading, discovery precedence, selection resolution, session state, command/shortcut/status behavior, prompt injection, and no role crossover.

## Technical Surface

- **Discovery and definitions:** `extensions/pi-gremlins/gremlin-definition.ts`, `extensions/pi-gremlins/gremlin-discovery.ts`, and new shared agent-definition/discovery helpers as needed for both `primary` and `sub-agent` roles.
- **Session state:** new primary-agent state module under `extensions/pi-gremlins` using a `pi-gremlins`-owned custom session entry type and minimal identity persistence.
- **Extension hooks and controls:** `extensions/pi-gremlins/index.ts` or extracted modules for command registration, shortcut handling, status updates, session lifecycle loading, and `before_agent_start` prompt mutation.
- **Prompt handling:** primary-agent prompt block helpers that append selected markdown exactly once and avoid duplicate or stale blocks.
- **Docs:** `README.md`, `CHANGELOG.md`, and later `pi-mohawk` README/changelog deprecation notes after support ships.
- **Tests:** Bun tests beside `extensions/pi-gremlins` modules, porting relevant `pi-mohawk` coverage from definition, discovery, session-state, extension command/status, and prompt-injection tests.
- **Related ADRs:** [ADR-0003](../adr/0003-unified-agent-discovery-and-primary-agent-prompt-injection-in-pi-gremlins.md) for unified agent discovery, prompt injection, session entry compatibility, compatibility command/status naming, and dual-package conflict handling.

## UX Notes

- Compatibility matters, but `pi-gremlins` remains the package identity. Human-facing copy may explain the migration; machine-facing identifiers stay `pi-gremlins` unless explicitly retained as compatibility aliases.
- Primary-agent status should stay concise: `Primary: None` or `Primary: <name>`.
- Command feedback must be transcript-visible when no picker/UI path exists so terminal-only users can recover available names.
- Ambiguous name errors should list exact-case matching options and avoid changing current state.
- The picker/list should include `None` as a first-class clear option.
- Migration docs should tell users not to run both packages together once `pi-gremlins` support exists, because duplicate commands, shortcuts, status, or prompt injection can conflict.

## Rollout / Sequencing Notes

1. **Governance first.** Create PRD-0003 and a related ADR before runtime implementation.
2. **Shared parsing/discovery second.** Establish strict typed role loading without changing the gremlin tool contract.
3. **State and controls third.** Add primary-agent session state, command handling, shortcut cycling, and status updates.
4. **Prompt injection fourth.** Add `before_agent_start` mutation after state and discovery behavior are testable.
5. **Docs and deprecation fifth.** Document `pi-gremlins` primary-agent behavior, then deprecate `pi-mohawk` docs only after equivalent support ships.
6. **Full verification last.** Run focused Bun tests during phases and full repo checks after implementation.

## Open Questions

- Should `pi-gremlins` support a new branded primary-agent command alias in addition to `/mohawk`, and if so what exact name should be documented as canonical?
- Should legacy `pi-mohawk-primary-agent` session entries be read during migration, or should migration start clean with only new `pi-gremlins` session entries?
- Should the implementation strip old `pi-mohawk` prompt delimiters to prevent double injection when both packages are installed during transition?
- Should primary-agent discovery keep `pi-mohawk` symlink-ignoring behavior while gremlin discovery preserves existing `pi-gremlins` behavior, or should both roles share one symlink policy?
- What exact status key should `pi-gremlins` use for the primary-agent label while keeping user-visible status text compatible?

## Completion Summary

Implemented primary-agent support in `pi-gremlins` for GitHub issue #39. Delivered role-aware agent definition loading and discovery, strict `agent_type: primary` / `agent_type: sub-agent` separation, primary-agent selection through `/mohawk` compatibility controls, shortcut cycling, status updates, current-branch session reconstruction, legacy `pi-mohawk-primary-agent` read compatibility, new `pi-gremlins-primary-agent` writes, and `before_agent_start` prompt injection with duplicate/legacy block stripping.

Docs now describe both agent roles, migration behavior, command/status semantics, session scope, prompt block behavior, and PRD/ADR references. Verification required for completion passed before this status change: `npm run typecheck`, `npm test`, and `npm run check`.

## Revision History

- 2026-04-25: Marked Completed after implementation review PASS; recorded delivered primary-agent behavior and verification evidence.
- 2026-04-25: Activated for implementation after ADR-0003 acceptance; replaced placeholder ADR references with concrete ADR link.
- 2026-04-25: Draft created for GitHub issue #39 product scope.
