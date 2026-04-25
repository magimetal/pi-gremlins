# PRD-0002: Pi Gremlins V1 SDK Rewrite

- **Status:** Draft
- **Date:** 2026-04-22
- **Author:** Magi Metal
- **Related:** `extensions/pi-gremlins`, `README.md`, `docs/adr/0002-in-process-sdk-based-gremlin-runtime.md` (ADR-0002), `docs/plans/pi-gremlins-v1-sdk-rewrite.md`
- **Supersedes:** None

## Problem Statement

`pi-gremlins` currently pays for isolation with an extra Pi subprocess per gremlin, protocol parsing, temp prompt file management, manual process shutdown logic, viewer snapshot projection, and multiple feature branches that are no longer worth carrying in a reliability-first v1. That runtime surface has become main failure source: subagent processes sometimes do not terminate cleanly, cancellation is hard to trust, and each attempted fix increases complexity in `extensions/pi-gremlins` instead of reducing it.

Main user need is narrower than current implementation: summon 1-10 gremlins, give each one fresh isolated context, watch progress inline, and get reliable completion without hung subprocess cleanup. Current feature set overshoots that need with chain mode, popup viewer, targeted steering, scope toggles, package-agent discovery, and session-local viewer architecture that adds code surface but does not solve core reliability problem.

V1 rewrite must keep premise and operator value, but deliberately cut scope until runtime is dependable and fast:

- Gremlin definitions still come from user and project agent directories, gated by `agent_type: sub-agent` frontmatter.
- One invocation shape only.
- One to ten gremlins only.
- More than one gremlin means true parallel execution.
- Each gremlin gets only current computed system prompt, its own markdown definition, and caller-supplied context.
- No full parent conversation history.
- No chain mode.
- No popup viewer, no `/gremlins:view`, no targeted steering command.
- Inline progress must stay visible and expand with Pi's existing `Ctrl+O` tool-row affordance.

## Product Goals

- Make gremlin execution reliable enough that cancellation and completion can be trusted again.
- Remove subprocess-management class of bugs from default runtime architecture.
- Reduce latency per gremlin by eliminating extra Pi CLI startup, JSONL parsing, and temp prompt files.
- Ship one narrow, easy-to-understand v1 surface instead of many partially overlapping modes.
- Preserve prompt isolation strictly: no inherited conversation transcript, no inherited AGENTS files, no inherited extensions/skills/prompts in child sessions.
- Keep inline progress useful during execution without restoring popup/view complexity.

## User Stories

- As an operator, I want to summon several gremlins in one call so that I can fan out focused work fast.
- As an operator, I want each gremlin to run with isolated context so that parent-session noise does not pollute results.
- As an operator, I want inline per-gremlin progress so that I can tell what is active, stuck, completed, failed, or canceled without opening another surface.
- As an operator, I want `Ctrl+O` expansion on same inline row so that I can inspect more detail only when needed.
- As a maintainer, I want runtime architecture small and deterministic so that shutdown and abort behavior stay testable.
- As a cautious user, I want source visibility for user vs project gremlins so that trust-relevant provenance remains visible even after scope simplification.

## Scope

### In Scope

- Rewrite runtime from scratch around in-process SDK sessions rather than Pi CLI subprocesses.
- Keep package/tool identifier `pi-gremlins` and human-facing `Gremlins🧌` branding.
- Discover gremlins from both:
  - `~/.pi/agent/agents/*.md`
  - nearest project `.pi/agents/*.md`
- Resolve duplicate gremlin names with nearest project `.pi/agents` taking precedence over user-level definitions among typed sub-agent files.
- One tool parameter shape only:
  - `gremlins: [{ agent, context, cwd? }, ...]`
  - array length constrained to `1..10`
- If `gremlins.length === 1`, run one gremlin.
- If `gremlins.length > 1`, start all gremlins in parallel with no hidden lower concurrency cap.
- Parse gremlin frontmatter for runtime config such as model / thinking / tools when present.
- Build child sessions with:
  - current computed parent system prompt snapshot
  - raw gremlin markdown contents
  - caller-supplied context string
  - in-memory session manager
  - custom resource loader that disables inherited extensions, prompts, skills, themes, AGENTS files, and conversation history
- Inline progress model with per-gremlin status, current activity, latest text/tool summary, usage, and terminal outcome.
- Collapsed and expanded render states on Pi's built-in tool row using existing `Ctrl+O` expansion behavior.
- Deterministic abort behavior that cancels all running child sessions when parent run is aborted or Pi session shuts down.
- Final tool result summary that reports per-gremlin outcomes and marks tool execution error when any gremlin fails or is canceled.
- Bun regression coverage for discovery, prompt isolation, parallel scheduling, cancellation, progress projection, and rendering.

### Out of Scope / Non-Goals

- Chain mode.
- Popup viewer and `/gremlins:view`.
- Targeted steering and `/gremlins:steer`.
- `agentScope`, `confirmProjectAgents`, package-agent discovery, or any user-facing scope selector.
- Package-provided gremlin definitions.
- Session-local viewer snapshot architecture from current implementation.
- Persistence, archives, cross-session history, replay, or inspection dashboard.
- Reusing current runtime modules as implementation substrate.
- Compatibility shims for old `agent` / `task` / `tasks` / `chain` input schema.
- Broad trust-policy redesign beyond visible provenance labels.

## Acceptance Criteria

- [ ] Tool schema exposes exactly one invocation shape: `gremlins: [...]`, with minimum 1 and maximum 10 gremlin requests.
- [ ] Public tool schema does not expose `agent`, `task`, `tasks`, `chain`, `agentScope`, or `confirmProjectAgents`.
- [ ] Gremlin discovery loads only `agent_type: sub-agent` markdown files from user-level `~/.pi/agent/agents` plus nearest project `.pi/agents` and does not load package-provided agent resources.
- [ ] Duplicate gremlin names resolve deterministically with project-local definition winning over user-level definition among typed sub-agent files.
- [ ] Child gremlin sessions do not receive parent conversation history.
- [ ] Child gremlin sessions do not load AGENTS files, extensions, prompts, skills, or themes from parent runtime.
- [ ] Child gremlin sessions receive current computed system prompt snapshot, raw gremlin markdown contents, and supplied context only.
- [ ] More than one gremlin request starts parallel execution immediately; runtime does not serialize by default and does not impose lower internal concurrency than requested gremlin count.
- [ ] Abort from parent tool execution cancels every running gremlin session and leaves no active child sessions registered after completion.
- [ ] Tool row shows inline live progress for every gremlin while execution is active.
- [ ] Collapsed result remains readable for 1-10 gremlins and includes status, gremlin identity, and current/latest activity.
- [ ] Expanded result opens through Pi's standard `Ctrl+O` tool expansion path and shows richer per-gremlin detail without popup UI.
- [ ] Runtime does not spawn `pi --mode rpc`, `pi --mode json`, or any other nested Pi CLI process for normal gremlin execution.
- [ ] Runtime does not write temp prompt files to pass system prompts into child gremlins.
- [ ] Any single gremlin failure or cancellation is reflected in final aggregate result, with per-gremlin status preserved.
- [ ] If any gremlin fails or is canceled, tool result is reported as error to parent model while still including all completed sibling results.
- [ ] Gremlin source provenance (`user` or `project`) is visible in inline rendering.
- [ ] Code is split into focused files; no new god file replaces current `index.ts` monolith.
- [ ] Legacy runtime modules are removed only after grep/reference audit proves new entrypoint no longer imports or depends on them.
- [ ] Automated coverage exists for discovery precedence, prompt isolation, parallel execution, cancellation cleanup, progress rendering, expanded rendering, and legacy-schema rejection.

## Technical Surface

- **Extension entry:** `extensions/pi-gremlins/index.ts` rewritten from zero to register only v1 tool and wire lifecycle cleanup.
- **Discovery:** new modules for gremlin definition loading, frontmatter parsing, `agent_type: sub-agent` gating, both-scope resolution, and duplicate-name precedence.
- **Child-session runtime:** new SDK-based session factory using `createAgentSession()`, in-memory session state, and custom `ResourceLoader`/system prompt override.
- **Execution:** new scheduler and invocation controller for 1-10 gremlins, structured cancellation, event fan-in, and aggregate result handling.
- **Rendering:** new inline collapsed/expanded renderer only; no overlay, popup, viewer snapshot, or steering UI.
- **Testing:** new Bun tests beside rewritten modules; no dependency on current viewer-specific test helpers except generic Bun mocking patterns.
- **Related ADRs:** ADR-0002 — `docs/adr/0002-in-process-sdk-based-gremlin-runtime.md`

## UX Notes

- Inline row is primary and only inspection surface for v1.
- `Ctrl+O` expansion must reuse Pi's existing tool-row expansion affordance instead of inventing new hotkeys.
- Collapsed view should bias toward scan speed:
  - status
  - gremlin name
  - source badge
  - current/latest activity
  - short terminal summary
- Expanded view should add detail, not alternate navigation.
- No popup chrome, no nested overlay, no second-screen concept.
- Running state should distinguish at least: queued, active, completed, failed, canceled.
- Provenance badges must be concise. `user` / `project` is enough for v1.
- If a gremlin has no meaningful output yet, row should still show current phase instead of generic empty text alone.
- Performance beats ornament. No decorative animation requirement for v1.

## Research Inputs

Primary references used for this PRD:

- Pi SDK guidance in `docs/sdk.md`: same-process Node/TypeScript integrations should prefer `AgentSession` over RPC subprocesses.
- Pi RPC guidance in `docs/rpc.md`: RPC is for subprocess-based or cross-language embedding, not best-fit for same-process extension code.
- Pi extensions and TUI guidance in `docs/extensions.md` and `docs/tui.md`: tool `onUpdate`, `renderResult`, and built-in tool-row expansion already provide inline progress and `Ctrl+O` expansion path.
- Pi example `examples/sdk/12-full-control.ts`: proves full-control `ResourceLoader` can remove discovery and build custom isolated agent sessions.
- Pi example `examples/extensions/subagent/index.ts`: good historical reference for old subprocess pattern, but also clear evidence of complexity we are intentionally removing.
- Node `child_process` docs: killing a spawned parent does not reliably terminate grandchildren on Linux when shells/process trees are involved.
- Execa termination docs: high-surface reference if subprocess isolation is ever revisited, especially for graceful cancellation and force-kill fallback. Not selected for v1 default.

## Open Questions

- Should v1 keep parent model as fallback when gremlin frontmatter omits `model`, or require every gremlin to resolve explicit model metadata? Recommendation: inherit parent model when absent for smoother migration.
- Should final aggregate text sort gremlins by request order only, or group failures first in summary? Recommendation: preserve request order, surface failure badges inline.
- Should project-local gremlin discovery be silent or should inline rendering explicitly mark project-sourced gremlins even in collapsed mode? Recommendation: always mark source inline.

## Revision History

- 2026-04-22: Draft created
