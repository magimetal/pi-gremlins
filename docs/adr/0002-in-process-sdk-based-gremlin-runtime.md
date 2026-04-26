# ADR-0002: In-Process SDK-Based Gremlin Runtime

- **Status:** Accepted
- **Date:** 2026-04-22
- **Decision Maker:** Magi Metal
- **Related:** `extensions/pi-gremlins`, `docs/prd/0002-pi-gremlins-v1-sdk-rewrite.md` (PRD-0002), `docs/plans/pi-gremlins-v1-sdk-rewrite.md`, `docs/adr/0001-semantic-presentation-architecture-for-pi-gremlins-viewer-and-embedded-surfaces.md` (ADR-0001)
- **Supersedes:** ADR-0001

## Context

Current `pi-gremlins` implementation centers on nested Pi CLI subprocesses and viewer-specific runtime projection.

Main complexity sits in:

- `extensions/pi-gremlins/single-agent-runner.ts` — spawns nested Pi processes, manages stdout JSON parsing, temp prompt files, abort timers, late exit handling, and steerable RPC sessions.
- `extensions/pi-gremlins/execution-modes.ts` — supports single, parallel, and chain execution.
- `extensions/pi-gremlins/index.ts` plus viewer modules — manages popup overlay state, inline/viewer semantic projection, and targeted steering.

This architecture solved isolation by process boundary, but it also created repeated failure surface:

- Extra Pi process startup per gremlin.
- Temp file writes for delegated system prompts.
- JSONL protocol handling and malformed line recovery.
- Manual stdin shutdown, SIGTERM, SIGKILL, and late-exit edge handling.
- Viewer snapshot machinery that v1 no longer needs.
- Public mode surface larger than actual high-value use case.

User requirement for rewrite changes architecture target completely:

- Fresh start.
- No chain mode.
- No popup/viewer.
- No scope toggles.
- Always discover both user and project gremlins.
- Inline progress only.
- Best possible reliability and low latency.
- Child gremlins need prompt isolation, not process isolation.

Pi's own documentation in `docs/sdk.md` explicitly recommends using `AgentSession` directly from `@mariozechner/pi-coding-agent` when building inside same Node.js process, and describes RPC mode in `docs/rpc.md` as fit for subprocess-based or cross-language clients. That distinction matters here: `pi-gremlins` is an in-process Pi extension written in TypeScript, so SDK path removes an entire nested-process layer while preserving isolated session state.

## Decision Drivers

- Reliability: eliminate stuck nested Pi subprocesses as default failure class.
- Performance: remove CLI startup, JSON serialization/parsing, temp file I/O, and extra process lifetime management.
- Isolation correctness: child gremlins must receive selected gremlin markdown as their system prompt plus passed intent/context as their user prompt; parent system prompt snapshots, primary-agent prompt blocks, and orchestration rules must not cross into child sessions.
- Scope reduction: architecture should match slimmed v1 surface, not legacy viewer/chain feature set.
- Maintainability: smaller, testable module graph with no new god file.
- Abort behavior: cancellation must be structured, deterministic, and easy to prove in tests.
- UX fit: inline progress plus standard `Ctrl+O` expansion already exists in Pi tool rendering model.

## Options Considered

### Option A: Keep Pi CLI subprocesses and continue using RPC/JSONL

- Pros:
  - Preserves hard process boundary.
  - Reuses existing mental model from current implementation and historical subagent example.
  - Child crashes stay isolated from parent process.
- Cons:
  - Keeps current pain source alive: spawn/close/kill complexity.
  - Adds startup latency for every gremlin.
  - Requires protocol handling, temp prompt file writes, and extra cleanup code.
  - Node docs explicitly warn that killing a child process does not necessarily kill grandchildren/process trees in common shell cases.
  - Still leaves us maintaining exactly class of bug user wants to escape.

### Option B: Replace CLI subprocesses with custom `child_process.fork()` or alternate subprocess transport

- Pros:
  - Could reduce some JSONL/stdio complexity versus full CLI shell-out.
  - Retains process isolation.
  - Could use richer IPC than line-delimited stdout.
- Cons:
  - Still process lifecycle architecture.
  - Still requires parent/child protocol, cleanup, and timeout policy.
  - Still pays process startup overhead.
  - Still solves wrong problem for v1, because requirement is prompt isolation, not OS-process isolation.

### Option C: Use in-process SDK sessions (`createAgentSession`) with custom isolated resource loader

- Pros:
  - Matches Pi SDK guidance for same-process TypeScript integrations.
  - Removes nested Pi CLI subprocesses, protocol parsing, and temp files entirely.
  - Preserves isolation by giving each gremlin its own in-memory `AgentSession` and empty resource world.
  - Gives direct event subscription for message/tool progress without transport translation.
  - Lets parent tool use one structured cancellation tree over all child sessions.
  - Simplifies inline rendering because progress data is already in-memory.
- Cons:
  - Child gremlins share parent Node process, so catastrophic in-process bugs are not isolated by OS boundary.
  - Requires careful custom `ResourceLoader` work to avoid accidentally inheriting parent extensions, AGENTS files, or prompts.
  - Requires fresh implementation rather than incremental patching.

## Decision

Chosen: **Option C: Use in-process SDK sessions (`createAgentSession`) with custom isolated resource loader**.

Rationale: User asked for full rewrite because subprocess termination has been patched repeatedly and remains unreliable. Pi SDK docs explicitly position direct `AgentSession` use as correct fit for same-process Node/TypeScript integrations, while RPC mode is framed as subprocess/client integration path. V1 needs prompt isolation only. Separate in-memory child sessions provide that isolation without nested Pi process lifecycle. This removes most fragile runtime surface at once: spawn, stdout protocol, temp files, subprocess abortion races, and viewer projection complexity.

## Consequences

- **Positive:**
  - Default runtime no longer depends on nested Pi subprocesses.
  - Lower latency per gremlin due to no CLI bootstrap and no temp prompt files.
  - Cancellation and cleanup move to direct session abort/dispose lifecycle.
  - Public feature surface shrinks to one invocation shape and one inline UI path.
  - Architecture better matches Pi's documented SDK usage model.
- **Negative:**
  - OS-process isolation is intentionally traded away.
  - Child-session isolation must be enforced through custom resource loading, gremlin-only system prompt construction, and test coverage, not by separate process default.
  - Existing viewer-specific architecture and chain runtime become dead code and must be deleted after cutover.
- **Follow-on constraints:**
  - Child gremlins must not bind parent extensions or load ambient AGENTS/skills/prompts/themes.
  - Child gremlins must not receive parent system prompt snapshots, primary-agent prompt blocks, active primary-agent markdown, or parent orchestration rules.
  - Inline rendering becomes only supported inspection surface for v1.
  - If subprocess isolation is revisited later, it requires a new ADR instead of quietly reintroducing process management.

## Implementation Impact

- **apps/api:** N/A. Standalone Pi package, no `apps/api` workspace.
- **apps/web:** N/A. No web frontend package.
- **packages/shared:** N/A. No shared package contract change.
- **packages/utils:** N/A. No standalone utils package in this repository.
- **Migration/ops:**
  - No persistence or config migration.
  - Public tool schema changes materially: old multi-mode params are removed in favor of `gremlins: [{ intent, agent, context, cwd? }, ...]`.
  - Legacy commands `/gremlins:view` and `/gremlins:steer` are removed as part of rewrite.
  - Extension entry remains under `./extensions/pi-gremlins`, but implementation beneath it is rewritten from scratch and legacy modules deleted after cutover verification.

## Verification

- **Automated:**
  - `npm run typecheck`
  - `npm test`
  - Regression tests proving:
    - no nested `pi --mode rpc` / `pi --mode json` subprocess spawn in normal execution path
    - child sessions receive no parent conversation history
    - child sessions load no AGENTS/extensions/prompts/skills/themes
    - 1..10 gremlin scheduling and parallel execution semantics
    - aggregate abort cancels all child sessions and leaves no active runtime state
    - collapsed and expanded inline rendering stay readable and deterministic
- **Manual:**
  - Run one gremlin and verify inline active progress appears immediately, then expand with `Ctrl+O`.
  - Run 3-5 gremlins in parallel and verify no popup surface exists, statuses update independently, and final aggregate state reflects mixed outcomes.
  - Abort active run and verify all gremlins stop promptly with canceled state visible inline.
  - Verify a project-local gremlin is marked `project` in inline output and overrides same-name user gremlin.

## Notes

Research inputs driving this decision:

- `docs/sdk.md`: recommends `AgentSession` directly for same-process Node.js/TypeScript work.
- `docs/rpc.md`: positions RPC as subprocess or cross-language integration path.
- `docs/extensions.md`: tool `onUpdate`, `renderResult`, and built-in expansion affordances already satisfy inline progress requirement.
- `docs/tui.md`: no popup required; standard tool-row expansion is enough for v1.
- `examples/sdk/12-full-control.ts`: demonstrates empty-resource `ResourceLoader` pattern needed for strict child-session isolation.
- Node `child_process` docs: child kill semantics are weaker than many expect, especially around grandchildren/process trees.
- Execa termination docs: useful fallback reference if process isolation ever returns, especially for graceful abort and force-kill policy.

This ADR intentionally supersedes ADR-0001. ADR-0001 optimized popup viewer and shared viewer-entry presentation surfaces. V1 rewrite removes popup viewer entirely and no longer treats viewer architecture as core runtime boundary.

## Status History

- 2026-04-22: Accepted; supersedes ADR-0001 in favor of SDK-based in-process child sessions and inline-only v1 UI
- 2026-04-24: Noted required per-gremlin `intent` field as part of public v1 request contract and child prompt framing
- 2026-04-25: Clarified issue #41 prompt-isolation boundary after primary-agent merge: gremlin child sessions use selected sub-agent markdown as system prompt and do not propagate parent prompt snapshots or primary-agent blocks
