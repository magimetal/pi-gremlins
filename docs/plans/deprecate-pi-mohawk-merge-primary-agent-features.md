# Plan: Deprecate pi-mohawk and merge primary-agent features into pi-gremlins

## Objective

Move all `pi-mohawk` primary-agent selection and prompt-injection functionality into `pi-gremlins`, then deprecate `pi-mohawk` as a separate package. The merged package should keep `pi-gremlins` as the install/runtime package identity while adding first-class primary-agent controls beside existing gremlin sub-agent delegation.

## Discovery synthesis

### pi-mohawk source functionality

Observed files:

- `/Users/magimetal/Dev/pi/pi-mohawk/extensions/pi-mohawk.ts`
- `/Users/magimetal/Dev/pi/pi-mohawk/extensions/agent-discovery.ts`
- `/Users/magimetal/Dev/pi/pi-mohawk/extensions/agent-definition.ts`
- `/Users/magimetal/Dev/pi/pi-mohawk/extensions/session-state.ts`
- `/Users/magimetal/Dev/pi/pi-mohawk/tests/*.test.ts`
- `/Users/magimetal/Dev/pi/pi-mohawk/docs/prd/0001-primary-agent-session-selector.md`
- `/Users/magimetal/Dev/pi/pi-mohawk/docs/adr/0001-extension-hook-architecture-for-primary-agents.md`

`pi-mohawk` currently provides:

- Primary-agent markdown discovery from user `getAgentDir()/agents` and nearest project `.pi/agents`.
- `agent_type: primary` filtering.
- Display name precedence: frontmatter `name`, first H1, filename stem.
- User definitions load first; nearest project definitions override by display name.
- Symlinked markdown ignored for primary-agent discovery.
- Exact and case-insensitive selection, with ambiguous case-insensitive names rejected.
- `/mohawk`, `/mohawk <name>`, `/mohawk none` command.
- `ctrl+shift+m` shortcut cycling `[None, ...sorted primary agents]`.
- UI status key `pi-mohawk`, label `Primary: <name|None>`.
- Non-UI command fallback that emits transcript-visible available names.
- Current-branch session persistence using custom entry type `pi-mohawk-primary-agent` with minimal identity only.
- `before_agent_start` prompt injection using a delimited raw markdown block.
- Missing selected agent reset to `None` with warning and persisted clear entry.

### pi-gremlins target functionality

Observed files:

- `extensions/pi-gremlins/index.ts`
- `extensions/pi-gremlins/gremlin-definition.ts`
- `extensions/pi-gremlins/gremlin-discovery.ts`
- `extensions/pi-gremlins/gremlin-prompt.ts`
- `extensions/pi-gremlins/gremlin-session-factory.ts`
- `extensions/pi-gremlins/gremlin-runner.ts`
- `extensions/pi-gremlins/gremlin-scheduler.ts`
- `extensions/pi-gremlins/*test.js`
- `README.md`
- `docs/prd/0002-pi-gremlins-v1-sdk-rewrite.md`
- `docs/adr/0002-in-process-sdk-based-gremlin-runtime.md`

`pi-gremlins` currently provides:

- Tool `pi-gremlins` with human label `Gremlins🧌`.
- Tool schema `gremlins: [{ intent, agent, context, cwd? }]`, 1..10.
- `agent_type: sub-agent` discovery from same user/project agent directories.
- User/project precedence consistent with `pi-mohawk` for sub-agent definitions.
- In-process SDK child sessions with isolated child context.
- Parent system prompt snapshot captured via `ctx.getSystemPrompt()` for child gremlin prompts.
- Inline collapsed/expanded progress rendering.
- Bun tests colocated with `extensions/pi-gremlins` modules.

### Shared functionality and consolidation opportunity

Both packages already implement near-identical direct-markdown discovery concerns:

- same user/project search roots;
- same project precedence policy;
- same frontmatter parsing shape;
- same agent-directory runtime dependency on `getAgentDir()`;
- separate typed filters: `primary` vs `sub-agent`.

Consolidation should extract an agent-definition/discovery layer inside `extensions/pi-gremlins` that can load both primary agents and gremlins without duplicating filesystem fingerprinting and frontmatter parsing.

## PRD / ADR recommendations

### Required PRD

Create a new pi-gremlins PRD before implementation.

Why: this is a significant user-facing scope expansion. `pi-gremlins` changes from sub-agent delegation only into combined agent orchestration: primary-agent selection plus gremlin delegation. Public controls, docs, install migration, and expected session behavior all change.

Recommended PRD title:

- `PRD-0003: Primary Agent Selection in pi-gremlins and pi-mohawk Deprecation`

PRD must define:

- retained `pi-gremlins` package/tool identity;
- new primary-agent controls and user stories;
- migration/deprecation behavior for `pi-mohawk` users;
- acceptance criteria for discovery, selection, prompt injection, session persistence, UI status, command/shortcut behavior, and docs;
- explicit non-goals around changing gremlin tool schema or reintroducing legacy gremlin runtime features.

### Required ADR

Create a new pi-gremlins ADR before implementation.

Why: this changes extension runtime boundaries by adding a `before_agent_start` prompt mutation path and session-level primary-agent state into the existing gremlin extension. It also introduces shared agent discovery infrastructure for two agent types and forces decisions about compatibility with existing `pi-mohawk` persisted session entries.

Recommended ADR title:

- `ADR-0003: Unified Agent Discovery and Primary-Agent Prompt Injection in pi-gremlins`

ADR must decide:

- one extension entrypoint remains `./extensions/pi-gremlins`;
- primary-agent prompt injection runs in same extension as gremlin tool registration;
- shared discovery module handles `primary` and `sub-agent` without loading untyped markdown;
- persisted entry strategy: whether to read legacy `pi-mohawk-primary-agent` entries during transition, write only new `pi-gremlins-primary-agent` entries, or intentionally skip legacy session migration;
- status/command naming: whether compatibility aliases `/mohawk` and `ctrl+shift+m` remain, and what new `pi-gremlins`-branded controls exist.

## Scope boundaries

### In scope

- Add primary-agent discovery to `pi-gremlins` from `~/.pi/agent/agents` and nearest `.pi/agents`.
- Support only markdown files with `agent_type: primary` as selectable primary agents.
- Keep existing gremlin discovery support for `agent_type: sub-agent`.
- Share parsing/fingerprinting/discovery code where practical.
- Add session-scoped selected primary-agent state in `pi-gremlins`.
- Add prompt injection through `before_agent_start` for the selected primary agent.
- Add user controls for selecting/clearing/cycling primary agents.
- Preserve or intentionally alias existing pi-mohawk UX: `/mohawk`, `/mohawk none`, `ctrl+shift+m`, `Primary: None` status semantics.
- Update README and changelog.
- Add deprecation documentation to `pi-mohawk` repository after pi-gremlins support ships.
- Port relevant `pi-mohawk` Vitest coverage into Bun tests under `extensions/pi-gremlins`.

### Out of scope

- Changing `pi-gremlins` tool schema for sub-agent delegation.
- Reintroducing chain mode, popup viewer, steering, package gremlin discovery, or scope toggles.
- Editing/creating/deleting agent markdown files from the extension.
- Persisting primary-agent selection across unrelated new Pi sessions unless explicitly accepted in the PRD.
- Loading untyped or malformed markdown as primary agents or gremlins.
- Pulling `pi-mohawk` package code wholesale without adapting to pi-gremlins test/runtime conventions.

## Phased implementation plan

### Phase 0 — Governance and implementation issue

What:

- Create PRD and ADR in pi-gremlins before production code.
- Link this plan and the GitHub issue from the PRD/ADR.
- Keep PRD `Draft` until plan accepted, then mark `Active` before implementation.

References:

- `docs/prd/README.md`
- `docs/adr/README.md`
- `docs/prd/0002-pi-gremlins-v1-sdk-rewrite.md`
- `docs/adr/0002-in-process-sdk-based-gremlin-runtime.md`

Acceptance criteria:

- PRD exists and captures user-facing primary-agent selection + pi-mohawk deprecation scope.
- ADR exists and captures unified discovery + prompt injection architecture.
- README/index tables cross-link related PRD/ADR.

Guardrails:

- Do not implement runtime code before governance artifacts exist.
- Do not alter ADR-0002 decision prohibiting nested Pi subprocess runtime.

Verification:

- Read back PRD and ADR.
- Confirm `docs/prd/README.md` and `docs/adr/README.md` include new rows.

### Phase 1 — Extract shared agent definition parsing

What:

- Introduce shared parsing utilities inside `extensions/pi-gremlins` for markdown frontmatter parsing, scalar/list reads, H1 fallback, and filename fallback.
- Add `AgentSource = "user" | "project"` if current `GremlinSource` is too narrow or belongs in schema only.
- Update gremlin definition loading to use shared parser while preserving current `agent_type: sub-agent` strictness.
- Add primary-agent definition loader for `agent_type: primary`.

References:

- `extensions/pi-gremlins/gremlin-definition.ts`
- `extensions/pi-gremlins/gremlin-schema.ts`
- `/Users/magimetal/Dev/pi/pi-mohawk/extensions/agent-definition.ts`
- `/Users/magimetal/Dev/pi/pi-mohawk/tests/agent-definition.test.ts`

Acceptance criteria:

- `agent_type: sub-agent` behavior remains unchanged for gremlins.
- `agent_type: primary` primary-agent loader supports name fallback order: frontmatter `name`, first H1, filename stem.
- Untyped/malformed markdown is ignored for both roles.
- Primary-agent definitions expose raw markdown but no prompt injection happens yet.

Guardrails:

- Do not expose `primary` agents through `pi-gremlins` tool resolution.
- Do not accept legacy `agent_type: sub` as gremlin or primary unless PRD explicitly changes that contract.

Verification:

- Add Bun tests ported from pi-mohawk definition tests.
- Run `bun test extensions/pi-gremlins/*definition*.test.js` or nearest focused Bun test file.

### Phase 2 — Unify user/project discovery

What:

- Replace duplicated gremlin-only discovery internals with shared agent directory scanning/fingerprinting.
- Provide separate APIs:
  - `createGremlinDiscoveryCache()` for `agent_type: sub-agent`.
  - `createPrimaryAgentDiscoveryCache()` or unified cache projection for `agent_type: primary`.
- Preserve user/project precedence and deterministic sorting.
- Decide symlink policy in ADR/PRD. Recommendation: for primary agents, keep `pi-mohawk` security behavior and ignore symlinked markdown; for gremlins, avoid silently breaking existing pi-gremlins unless PRD accepts tightening.

References:

- `extensions/pi-gremlins/gremlin-discovery.ts`
- `extensions/pi-gremlins/gremlin-discovery.test.js`
- `/Users/magimetal/Dev/pi/pi-mohawk/extensions/agent-discovery.ts`
- `/Users/magimetal/Dev/pi/pi-mohawk/tests/agent-discovery.test.ts`

Acceptance criteria:

- Gremlin discovery still loads only sub-agent definitions.
- Primary discovery loads only primary definitions.
- Project definitions override user definitions by exact display name for both roles.
- Case-insensitive primary-agent resolution returns exact match, single folded match, ambiguous folded match, or not-found.
- Cache invalidation still reacts to directory/file mtime changes and session lifecycle clears.

Guardrails:

- Do not let primary agents be summoned as gremlins.
- Do not let sub-agents be selected as primary agents.
- Do not change public gremlin request schema.

Verification:

- Port and adapt pi-mohawk discovery tests into Bun.
- Run `bun test extensions/pi-gremlins/gremlin-discovery.test.js` plus new primary discovery test.

### Phase 3 — Add primary-agent session state

What:

- Add primary-agent state module under `extensions/pi-gremlins`.
- Use a new custom session entry type, recommended `pi-gremlins-primary-agent`.
- Decide legacy read compatibility in ADR:
  - Recommended: read latest valid entry among `pi-gremlins-primary-agent` and legacy `pi-mohawk-primary-agent`, but write only `pi-gremlins-primary-agent` after any new selection/change.
- Persist minimal selection identity only: selected name, source, file path. Never persist raw markdown.
- Reconstruct from `ctx.sessionManager.getBranch()` on `session_start`.

References:

- `/Users/magimetal/Dev/pi/pi-mohawk/extensions/session-state.ts`
- `/Users/magimetal/Dev/pi/pi-mohawk/tests/session-state.test.ts`
- `extensions/pi-gremlins/index.ts`

Acceptance criteria:

- Latest current-branch selection wins.
- Explicit `None` selection is persisted and reconstructed.
- Missing selected primary agent resets to `None` with diagnostic name.
- Raw markdown never appears in session entry data.
- Legacy `pi-mohawk-primary-agent` handling follows ADR decision.

Guardrails:

- Do not persist or inject raw primary-agent markdown into session entries.
- Do not leak abandoned branch selection into active branch.

Verification:

- Port session-state tests to Bun.
- Add test for legacy pi-mohawk entry read behavior if ADR accepts it.

### Phase 4 — Add command, shortcut, and status UX

What:

- Add command handler(s) in `extensions/pi-gremlins/index.ts` or extracted module:
  - Compatibility: `/mohawk`, `/mohawk <name>`, `/mohawk none`.
  - Optional branded alias if PRD chooses: `/gremlins:primary` or `/gremlins-primary`.
- Keep shortcut `ctrl+shift+m` unless conflict exists in pi-gremlins runtime.
- Set status label to `Primary: <name|None>`.
- Choose status key in ADR:
  - Recommended: use `pi-gremlins-primary` to avoid old package identity while preserving label.
- Preserve non-UI fallback: write transcript-visible list of available primary agents.

References:

- `/Users/magimetal/Dev/pi/pi-mohawk/extensions/pi-mohawk.ts`
- `/Users/magimetal/Dev/pi/pi-mohawk/tests/pi-mohawk-extension.test.ts`
- `extensions/pi-gremlins/index.ts`

Acceptance criteria:

- Command with exact name selects the agent.
- Command with single unambiguous case-insensitive name selects the agent.
- Command with ambiguous case-insensitive name leaves state unchanged and reports exact-case options.
- Command `none` clears selection.
- No-args command opens picker when UI exists.
- No-UI no-args command emits `Primary agents: None, ...` transcript message.
- Shortcut cycles deterministically through `[None, ...sorted primary agents]`.
- Status reflects current selection after startup and every selection change.

Guardrails:

- Do not remove or change `pi-gremlins` tool registration.
- Do not overload `pi-gremlins` tool input schema with primary-agent selection commands.

Verification:

- Port extension command/shortcut/status tests to Bun.
- Run focused Bun tests for primary-agent extension behavior.

### Phase 5 — Add prompt injection hook

What:

- Register `before_agent_start` in `pi-gremlins` extension.
- If selected primary agent exists, append raw markdown in a delimited block to `event.systemPrompt` and return updated system prompt.
- Strip existing block before appending to avoid duplicate injection.
- If selected primary agent is missing, persist `None`, update status, notify warning, and leave prompt unchanged.
- Choose new delimiters in ADR:
  - Recommended: `<!-- pi-gremlins primary agent:start -->` / `<!-- pi-gremlins primary agent:end -->`.
  - Optionally strip old `pi-mohawk` block too to prevent double-injection during migration.

References:

- `/Users/magimetal/Dev/pi/pi-mohawk/extensions/pi-mohawk.ts`
- `/Users/magimetal/Dev/pi/pi-mohawk/tests/prompt-injection.test.ts`
- `extensions/pi-gremlins/index.ts`
- `extensions/pi-gremlins/gremlin-prompt.ts`

Acceptance criteria:

- Selection `None` leaves prompt unchanged.
- Selected primary agent appends raw markdown inside delimiters.
- Repeated injection does not duplicate block.
- Missing selected agent resets state and leaves prompt unchanged.
- Child gremlin sessions receive parent system prompt snapshot that includes active primary-agent injection when Pi hook order makes that prompt available through `ctx.getSystemPrompt()`.

Guardrails:

- Do not inject sub-agent markdown through primary-agent path.
- Do not mutate provider payloads directly.
- Do not include unrelated local files or secrets.

Verification:

- Port prompt-injection tests to Bun.
- Add integration-style test around extension `before_agent_start` handler.
- Manual follow-up after implementation: select primary, send prompt, confirm behavior through diagnostic/runtime observation if available.

### Phase 6 — Documentation and deprecation flow

What:

- Update `pi-gremlins/README.md` with primary-agent feature, controls, discovery, session scope, and pi-mohawk migration notes.
- Update `pi-gremlins/CHANGELOG.md` with PRD/ADR references.
- After pi-gremlins release/support lands, update `pi-mohawk/README.md` and `CHANGELOG.md` to mark package deprecated and point users to `pi-gremlins`.
- Consider deprecating package metadata in `pi-mohawk/package.json` description/keywords only after release decision.

References:

- `README.md`
- `CHANGELOG.md`
- `/Users/magimetal/Dev/pi/pi-mohawk/README.md`
- `/Users/magimetal/Dev/pi/pi-mohawk/CHANGELOG.md`

Acceptance criteria:

- pi-gremlins README documents both `agent_type: sub-agent` and `agent_type: primary` roles without implying cross-use.
- README documents `/mohawk` compatibility or replacement command exactly as implemented.
- README documents deprecation path from `pi-mohawk` to `pi-gremlins`.
- CHANGELOG cites new PRD/ADR.
- pi-mohawk repo explicitly points users to pi-gremlins after migration lands.

Guardrails:

- Do not tell users to uninstall pi-mohawk until pi-gremlins contains equivalent primary-agent behavior.
- Do not rename machine-facing `pi-gremlins` identifiers.

Verification:

- Read back docs.
- Confirm command names, status keys, and frontmatter values match implementation.

### Phase 7 — Full verification and cleanup

What:

- Run full pi-gremlins verification after implementation.
- Remove unused imports/exports/files introduced during migration.
- Verify no stale references to copied pi-mohawk internals remain except compatibility strings intentionally documented.
- Optionally run pi-mohawk tests before deprecation README change to ensure no accidental source breakage if editing that repo.

References:

- `package.json`
- `extensions/pi-gremlins/*.test.js`
- `docs/prd/0002-pi-gremlins-v1-sdk-rewrite.md`
- new PRD/ADR from Phase 0

Acceptance criteria:

- `npm run typecheck` passes.
- `npm test` passes.
- `npm run check` passes.
- No unused exports/imports remain.
- Public v1 gremlin tool contract remains intact.
- PRD acceptance criteria are checked and updated.

Guardrails:

- Do not run broad formatting that churns unrelated files.
- Do not modify node_modules or generated AGENTS.md.

Verification:

- `npm run typecheck`
- `npm test`
- `npm run check`
- `rg "pi-mohawk|mohawk|primary-agent" extensions docs README.md CHANGELOG.md` to confirm only intentional references remain.

## Risks and compatibility notes

- **Hook ordering risk:** primary-agent prompt injection and gremlin child prompt capture both depend on Pi's computed system prompt lifecycle. Tests should cover `before_agent_start` output; manual runtime validation should confirm child gremlins see active primary prompt when expected.
- **Dual-package conflict risk:** if both `pi-mohawk` and updated `pi-gremlins` are installed, both can register `/mohawk`, shortcut, status, and prompt injection. Deprecation docs should tell users to uninstall/disable `pi-mohawk` after migration.
- **Session entry compatibility risk:** reading legacy `pi-mohawk-primary-agent` entries can smooth active-session migration, but writing only new entries avoids keeping old package identity alive.
- **Symlink policy mismatch:** current pi-gremlins gremlin discovery accepts symlinked markdown; pi-mohawk primary discovery ignores symlinks. ADR should choose intentional behavior per role.
- **Command naming risk:** keeping `/mohawk` maximizes user compatibility but preserves deprecated branding in UI. Add a pi-gremlins-branded alias if desired, but keep one canonical doc path.
- **Primary vs sub-agent separation risk:** shared discovery must never let primary agents become gremlin tools or sub-agents become prompt-injected primary agents.
- **Package deprecation sequencing risk:** deprecating pi-mohawk before pi-gremlins ships equivalent behavior strands existing users. Sequence docs accordingly.

## Suggested implementation issue shape

Title:

> Deprecate pi-mohawk by merging primary-agent selection into pi-gremlins

Labels:

- `enhancement`
- `planning`

Issue body should include this plan's discovery synthesis, phases, acceptance criteria, PRD/ADR requirements, and verification commands.
