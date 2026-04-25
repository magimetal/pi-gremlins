# ADR-0003: Unified Agent Discovery and Primary-Agent Prompt Injection in pi-gremlins

- **Status:** Accepted
- **Date:** 2026-04-25
- **Decision Maker:** Magi Metal
- **Related:** `extensions/pi-gremlins`, GitHub issue [#39](https://github.com/magimetal/pi-gremlins/issues/39), `docs/adr/0002-in-process-sdk-based-gremlin-runtime.md` (ADR-0002)
- **Supersedes:** N/A

## Context

GitHub issue #39 proposes deprecating the separate `pi-mohawk` package by moving its primary-agent selection and prompt-injection behavior into `pi-gremlins`.

Current package boundary:

- `pi-gremlins` owns gremlin sub-agent delegation through the `pi-gremlins` tool, in-process SDK child sessions, isolated child prompt construction, and inline progress rendering.
- `pi-mohawk` owns primary-agent discovery, selected primary-agent session state, `/mohawk` controls, status labeling, shortcut cycling, and `before_agent_start` system-prompt injection.

Both packages inspect the same agent directories and parse similar markdown frontmatter, but they apply different role filters:

- gremlins use `agent_type: sub-agent`;
- primary agents use `agent_type: primary`.

Keeping these behaviors split forces users to install and reason about two packages for one agent-orchestration workflow. Merging primary-agent behavior into `pi-gremlins` changes the extension/package boundary and adds a parent-session prompt mutation path beside existing gremlin child-session delegation, so the architecture decision needs to be explicit before implementation.

ADR-0002 remains in force: gremlin execution stays in-process through SDK child sessions and must not reintroduce nested Pi CLI subprocess runtime, popup viewer surfaces, chain mode, targeted steering, package gremlin discovery, or scope toggles.

## Decision Drivers

- Package clarity: users should install one package, `pi-gremlins`, for primary-agent selection and gremlin delegation.
- Runtime cohesion: primary-agent prompt mutation and gremlin child-session delegation both shape agent orchestration and should live in one extension entrypoint.
- Discovery correctness: shared filesystem/frontmatter parsing should not blur `primary` and `sub-agent` roles.
- Migration safety: existing `pi-mohawk` users need a compatibility path without preserving `pi-mohawk` as the long-term machine-facing package identity.
- Session privacy: selected primary-agent state must persist only minimal identity, not raw markdown prompt content.
- Compatibility containment: deprecated command/status affordances can exist as aliases, but new persisted state and internal keys should use `pi-gremlins` identity.
- ADR-0002 compatibility: merged primary-agent behavior must not change the gremlin tool schema or child-session runtime architecture.

## Options Considered

### Option A: Keep `pi-mohawk` as a separate package

- Pros:
  - No migration work inside `pi-gremlins`.
  - Existing `pi-mohawk` users keep current package, command, shortcut, and status behavior.
  - Primary-agent prompt injection remains isolated from gremlin delegation code.
- Cons:
  - Users must install two packages for one orchestration experience.
  - Agent markdown discovery and frontmatter parsing remain duplicated.
  - Dual extension state increases command/status/hook conflict risk.
  - `pi-gremlins` remains artificially limited to sub-agent delegation even though parent prompt selection is part of the same workflow.

### Option B: Move `pi-mohawk` behavior into `pi-gremlins` but keep separate internals and legacy identity

- Pros:
  - Reduces package count for users.
  - Preserves current `/mohawk` mental model with low behavior change.
  - Faster port if code is copied with minimal adaptation.
- Cons:
  - Keeps duplicated discovery/parsing code inside one package.
  - Preserves deprecated `pi-mohawk` identity in new session entries and internal status keys.
  - Makes future maintenance harder because primary and sub-agent discovery can drift.
  - Obscures that `pi-gremlins` is the surviving install/runtime identity.

### Option C: Merge primary-agent support into `pi-gremlins` with shared role-aware discovery and `pi-gremlins`-owned state

- Pros:
  - Gives users one surviving package and one extension entrypoint.
  - Shares agent markdown parsing, directory scanning, precedence, and cache invalidation.
  - Keeps strict role separation: `primary` agents cannot be summoned as gremlins, and `sub-agent` gremlins cannot be injected as primary agents.
  - Allows legacy `/mohawk` and shortcut compatibility while writing new state under `pi-gremlins` identity.
  - Keeps ADR-0002 gremlin runtime intact while adding only the needed parent prompt hook.
- Cons:
  - Adds more responsibility to the `pi-gremlins` extension entrypoint and test matrix.
  - Requires careful compatibility handling when both old `pi-mohawk` and new `pi-gremlins` are installed.
  - Requires porting `pi-mohawk` test coverage into Bun conventions.

## Decision

Chosen: **Option C: Merge primary-agent support into `pi-gremlins` with shared role-aware discovery and `pi-gremlins`-owned state**.

Rationale: issue #39 is a package-boundary correction, not just a code move. `pi-gremlins` becomes the single install/runtime package for agent orchestration, while `pi-mohawk` becomes deprecated after equivalent primary-agent behavior ships. The merged implementation should share discovery infrastructure across both agent roles, keep role filters strict, and preserve user-facing compatibility where it lowers migration risk.

The implementation must follow these architectural constraints:

- Keep the extension entrypoint at `./extensions/pi-gremlins`.
- Register primary-agent controls and `before_agent_start` prompt injection from the `pi-gremlins` extension, beside the existing `pi-gremlins` tool registration.
- Introduce shared markdown parsing/discovery infrastructure that accepts an explicit role filter and never loads untyped markdown into either role.
- Preserve existing gremlin tool contract; do not add primary-agent selection to the `pi-gremlins` tool schema.
- Persist new primary-agent selection entries as `pi-gremlins-primary-agent`.
- During transition, read the latest valid current-branch selection from either `pi-gremlins-primary-agent` or legacy `pi-mohawk-primary-agent`, but write only `pi-gremlins-primary-agent` after any selection change.
- Persist minimal selected identity only: selected name, source, and path. Do not persist raw markdown.
- Keep `/mohawk`, `/mohawk <name>`, `/mohawk none`, and `ctrl+shift+m` as compatibility controls unless implementation discovers a hard Pi conflict.
- Use a `pi-gremlins`-owned status key such as `pi-gremlins-primary`; keep the human-facing label `Primary: <name|None>`.
- Delimit injected primary-agent markdown with `<!-- pi-gremlins primary agent:start -->` and `<!-- pi-gremlins primary agent:end -->`.
- Strip any existing `pi-gremlins` primary-agent block before appending a new one to avoid duplicate injection. Also strip legacy `pi-mohawk` primary-agent blocks during migration to prevent double injection when old prompt content is present.

## Consequences

- **Positive:**
  - `pi-gremlins` becomes the single package that users install for gremlin delegation and primary-agent selection.
  - Shared discovery reduces duplicated filesystem/frontmatter behavior and keeps precedence policy consistent.
  - Deprecated `pi-mohawk` session entries can be honored during transition without continuing to write old package identity.
  - Parent prompt injection becomes explicit architecture in the surviving extension instead of an implicit cross-package side effect.
  - Existing gremlin v1 runtime and tool schema remain stable.
- **Negative:**
  - `pi-gremlins` extension startup, session lifecycle, and tests become broader.
  - If users run both packages simultaneously, command, shortcut, status, and prompt-hook conflicts are possible until deprecation docs tell them to disable or uninstall `pi-mohawk` after migration.
  - Compatibility aliases keep the `mohawk` name visible in controls during migration.
- **Follow-on constraints:**
  - Future changes to primary-agent persisted state or prompt-injection delimiters require ADR review because they affect session compatibility and runtime prompt composition.
  - Any future removal of `/mohawk` compatibility controls must be treated as a user-facing product decision, not hidden cleanup.
  - Shared discovery must continue to enforce role separation and must not use primary-agent markdown as gremlin prompt material or gremlin markdown as primary-agent prompt material.

## Implementation Impact

- **apps/api:** N/A. Standalone Pi package, no `apps/api` workspace.
- **apps/web:** N/A. No web frontend package.
- **packages/shared:** N/A. No shared package contract change.
- **packages/utils:** N/A. No standalone utils package in this repository.
- **Migration/ops:**
  - `pi-gremlins` remains the install/runtime package identity and extension entrypoint.
  - `pi-mohawk` can be deprecated after `pi-gremlins` ships equivalent primary-agent selection, prompt injection, command, shortcut, and status behavior.
  - Existing current-branch `pi-mohawk-primary-agent` entries are read as legacy input during transition, but new writes use `pi-gremlins-primary-agent` only.
  - Documentation must warn that running both old `pi-mohawk` and new `pi-gremlins` can duplicate controls or prompt injection.

## Verification

- **Automated:**
  - Focused Bun tests for shared agent definition parsing and strict `agent_type` role filtering.
  - Focused Bun tests for primary-agent discovery precedence, symlink policy, exact/case-insensitive selection, ambiguous match rejection, and cache invalidation.
  - Focused Bun tests for session state reconstruction from `pi-gremlins-primary-agent` and legacy `pi-mohawk-primary-agent` entries, with writes only to `pi-gremlins-primary-agent`.
  - Focused Bun tests for `/mohawk` command behavior, `ctrl+shift+m` cycling, no-UI fallback messaging, and `Primary: <name|None>` status updates.
  - Focused Bun tests for `before_agent_start` injection, duplicate block stripping, legacy block stripping, missing selected-agent reset, and no prompt mutation when selection is `None`.
  - Full repository verification after implementation: `npm run typecheck`, `npm test`, and `npm run check`.
- **Manual:**
  - Install updated `pi-gremlins`, select a primary agent, send a prompt, and confirm selected primary markdown affects the parent agent.
  - Run one or more gremlins while a primary agent is selected and confirm existing `pi-gremlins` tool behavior remains unchanged.
  - Confirm migration docs tell users when to disable or uninstall `pi-mohawk`.

## Notes

This ADR does not add external dependencies. It records package and runtime boundary choices for issue #39 before implementation.

ADR-0002 still governs gremlin execution architecture. If implementation pressure suggests restoring nested Pi subprocess execution, popup viewers, chain mode, targeted steering, package gremlin discovery, or scope toggles, stop and write a new ADR instead of folding those changes into issue #39.

## Status History

- 2026-04-25: Accepted; records issue #39 package-boundary decision to merge primary-agent selection and prompt injection into `pi-gremlins` while deprecating separate `pi-mohawk` package after equivalent behavior ships
