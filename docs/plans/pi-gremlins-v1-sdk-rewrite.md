# Plan: Pi Gremlins V1 SDK Rewrite

- **Status:** Ready for execution
- **Date:** 2026-04-22
- **Scope:** `extensions/pi-gremlins` only
- **References:** PRD-0002, ADR-0002
- **Primary objective:** Replace subprocess-based gremlin orchestration with fresh in-process SDK runtime that is smaller, faster, and materially easier to terminate correctly.
- **Verification baseline:** `npm run typecheck`, `npm test`

## Executive Direction

This plan does **not** patch current runtime again. It assumes full replacement.

Target v1 surface:

- one tool only: `pi-gremlins`
- one input shape only: `gremlins: [{ agent, context, cwd? }, ...]`
- array length `1..10`
- if more than one gremlin requested, all start in parallel
- load both user and nearest project gremlins automatically
- no scope selector
- no chain
- no popup viewer
- no `/gremlins:view`
- no `/gremlins:steer`
- no nested Pi CLI subprocesses in normal runtime path
- inline progress only, expanded through existing Pi tool-row `Ctrl+O`

## Research and Discovery Summary

### Pi-native references that matter most

1. **`docs/sdk.md`**
   - Pi explicitly recommends using `AgentSession` directly from `@mariozechner/pi-coding-agent` for same-process Node.js/TypeScript integrations.
   - `createAgentSession()` plus custom `ResourceLoader` gives us isolated in-memory child sessions without spawning nested Pi CLI processes.
   - `SessionManager.inMemory()` and full-control `ResourceLoader` let us remove session persistence and resource inheritance completely.

2. **`docs/rpc.md`**
   - RPC mode is documented as subprocess/headless protocol for embedding from other processes or languages.
   - Good reference for what current runtime is effectively doing.
   - Wrong default for this rewrite because extension already lives in same process and user wants less latency, less shutdown complexity, not more transport.

3. **`docs/extensions.md`**
   - `registerTool()` with `onUpdate` already supports streaming partial progress into tool rows.
   - `renderResult()` already plugs into Pi's built-in expand/collapse behavior.
   - No popup needed to satisfy inline inspection requirement.

4. **`docs/tui.md`**
   - Tool rows already have expansion affordance.
   - Custom components and tool renderers can stay inline and lightweight.
   - Caching guidance matters for per-gremlin live rendering.

5. **Examples**
   - `examples/sdk/12-full-control.ts` proves empty-resource child session pattern.
   - `examples/extensions/subagent/index.ts` is useful anti-reference: it shows older subprocess approach and why it grew too much complexity.
   - `examples/extensions/status-line.ts` and `widget-placement.ts` confirm we can add small supporting status if needed, but main v1 path should stay on tool row.

### External high-surface references

1. **Node `child_process` docs**
   - Parent `kill()` does not reliably terminate grandchildren/process trees in common cases.
   - Pipes can block when output is not consumed fast enough.
   - This is direct explanation for why nested Pi subprocess lifecycle stays brittle.

2. **Execa termination docs**
   - Strong reference for graceful cancellation, force-kill delay, and structured subprocess termination if process isolation ever comes back.
   - Not chosen for v1 default, but worth keeping as contingency reference.

3. **Structured concurrency references for JavaScript**
   - Useful framing: child work should live inside lexical parent scope, parent owns cancellation, scope does not finish until children are settled and cleaned up.
   - We can implement enough of this with plain `AbortController`, `Promise.allSettled`, and explicit session `abort()` / `dispose()`.

## Why SDK beats RPC here

### SDK advantages

- No `pi --mode rpc` child process startup.
- No JSONL transport parsing.
- No stdout malformed-line recovery.
- No temp prompt files.
- No child stdin close choreography.
- No SIGTERM / SIGKILL timers for nested Pi process.
- Direct typed event subscription from child session.
- Isolation still achieved through separate in-memory session plus empty `ResourceLoader`.

### RPC disadvantages for this rewrite

- Keeps process lifecycle as core architecture.
- Adds transport surface user explicitly wants to escape.
- Adds measurable spawn latency per gremlin.
- Adds more shutdown states than we need.
- Solves process isolation problem user no longer needs for v1.

### Decision

Use **SDK child sessions** as default runtime architecture. Treat subprocess references as fallback research only.

## Hard Guardrails

- No imports from current runtime modules into new runtime modules.
- No reuse of viewer snapshot architecture.
- No compatibility layer that preserves old public tool schema.
- No hidden lower concurrency cap than requested gremlin count.
- No loading of parent AGENTS files, extensions, prompts, skills, or themes into child sessions.
- No package-agent discovery.
- No popup overlay or viewer command.
- No targeted steering.
- No new god file. Entry file composes; it does not own all logic.
- Delete dead legacy modules only after grep/reference audit proves cutover complete.

## Proposed File Layout

Keep repo convention of flat TS files under `extensions/pi-gremlins/`.

### New v1 source set

- `extensions/pi-gremlins/index.ts`
  - extension entry
  - tool registration
  - session lifecycle cleanup
- `extensions/pi-gremlins/gremlin-schema.ts`
  - TypeBox schema
  - public params and result types
- `extensions/pi-gremlins/gremlin-definition.ts`
  - frontmatter parsing
  - normalized gremlin definition shape
- `extensions/pi-gremlins/gremlin-discovery.ts`
  - both-scope discovery
  - duplicate-name precedence
  - session-local discovery cache
- `extensions/pi-gremlins/gremlin-prompt.ts`
  - computed child prompt builder
  - prompt-isolation helpers
- `extensions/pi-gremlins/gremlin-session-factory.ts`
  - `createAgentSession()` wrapper
  - empty resource loader
  - tool/model resolution per gremlin
- `extensions/pi-gremlins/gremlin-runner.ts`
  - single gremlin runtime orchestration
  - event subscription
  - abort/dispose lifecycle
- `extensions/pi-gremlins/gremlin-scheduler.ts`
  - 1..10 launch orchestration
  - parallel fan-out
  - aggregate completion semantics
- `extensions/pi-gremlins/gremlin-progress-store.ts`
  - live mutable state records
  - revision counters
  - throttled partial update snapshots
- `extensions/pi-gremlins/gremlin-rendering.ts`
  - collapsed + expanded inline rendering
  - no popup logic
- `extensions/pi-gremlins/gremlin-render-components.ts`
  - small reusable TUI components/helpers if needed
- `extensions/pi-gremlins/gremlin-summary.ts`
  - aggregate final text generation
  - partial failure messaging
- `extensions/pi-gremlins/test-helpers.js`
  - fresh v1 test helpers only

### Legacy modules expected to be deleted at cutover

- `execution-modes.ts`
- `execution-shared.ts`
- `single-agent-runner.ts`
- `invocation-state.ts`
- `result-rendering.ts`
- `viewer-body-cache.ts`
- `viewer-open-action.ts`
- `viewer-overlay.ts`
- `viewer-result-navigation.ts`
- `tool-call-formatting.ts`
- `tool-text.ts`
- any viewer-specific or chain-specific tests

## Public API Proposal

```ts
pi-gremlins({
  gremlins: [
    {
      agent: "researcher",
      context: "Find auth flow and summarize entry points",
      cwd: "/optional/project/path"
    }
  ]
})
```

### Notes

- `gremlins.length === 1` => one gremlin session.
- `gremlins.length > 1` => all start in parallel immediately.
- No `mode` field.
- No `agentScope` field.
- No `confirmProjectAgents` field.
- No `chain` / `tasks` / `task` fields.

## Child Session Isolation Contract

Each child gremlin session must receive exactly these inputs:

1. **computed system prompt snapshot** from parent turn via `ctx.getSystemPrompt()`
2. **raw gremlin markdown contents** from resolved gremlin file
3. **caller-supplied context string** from tool params

Everything else is intentionally excluded:

- parent conversation history
- parent custom messages
- AGENTS files
- extension-registered commands/tools/prompts
- skills
- themes
- popup/viewer state

## Child Session Runtime Contract

Each gremlin runtime must:

- use `SessionManager.inMemory()`
- use custom `ResourceLoader` returning:
  - no extensions
  - no skills
  - no prompts
  - no themes
  - no AGENTS files
  - system prompt override = parent computed system prompt snapshot
  - append prompt = none
- choose model from:
  1. gremlin frontmatter model if resolvable
  2. otherwise parent current model
- choose thinking from:
  1. gremlin frontmatter thinking if supported
  2. otherwise parent current thinking level
- choose tools from gremlin frontmatter if present
- otherwise use default coding tools for gremlin cwd
- subscribe to child events directly
- call `abort()` then `dispose()` during teardown

## Live Progress Model

Track per gremlin:

- `status`: `queued | starting | active | completed | failed | canceled`
- `source`: `user | project`
- `agent`
- `cwd`
- `model`
- `turns`
- `input/output/cache/cost/context`
- `currentPhase`: `prompting | streaming | tool:<name> | settling`
- `latestText`
- `latestToolCall`
- `latestToolResult`
- `errorMessage`
- `startedAt`
- `finishedAt`
- `revision`

Aggregate invocation tracks:

- requested count
- active count
- completed count
- failed count
- canceled count
- anyError boolean
- aggregate revision

### Update throttling policy

- Child event handlers mutate live store immediately.
- UI partial updates are coalesced.
- Target flush cadence: at most once per ~33ms while streaming, immediate flush on terminal state.
- Reason: reduce TUI churn without hiding meaningful progress.

## Inline Rendering Contract

### Collapsed row

Per gremlin show:

- status icon + label
- gremlin name
- source badge
- current/latest activity line
- terminal preview or running phase
- small usage tail when available

Aggregate header show:

- `Gremlins🧌`
- `n requested`
- counts for active/completed/failed/canceled

### Expanded row (`Ctrl+O`)

Per gremlin show:

- full status
- source
- cwd if present
- model/thinking/tools summary
- original context
- latest assistant text block
- current or last tool call
- latest tool result excerpt
- usage telemetry
- terminal error details if any

### Explicit non-goals

- no alternate overlay
- no result navigation chrome
- no popup body cache
- no timeline view

## Dependency Order

1. **Task 0 — Freeze rewrite contract in tests and docs.**
2. **Task 1 — Scaffold fresh v1 files with zero legacy imports.**
3. **Task 2 — Discovery + definition parsing.**
4. **Task 3 — Child session factory and strict isolation.**
5. **Task 4 — Single gremlin runner and event projection.**
6. **Task 5 — Parallel scheduler and structured cancellation.**
7. **Task 6 — Inline rendering and partial update model.**
8. **Task 7 — Entry-point cutover and legacy deletion.**
9. **Task 8 — Final regression sweep and dead-code cleanup.**

## Task 0 — Lock rewrite contract with focused tests and fixture docs

- **What:** Create v1-first regression suite before implementation modules land. Freeze intended public API and core non-goals so implementation cannot drift back toward legacy surface.
- **Files:**
  - new `*.test.js` files for schema, discovery, isolation, scheduler, rendering
  - `docs/prd/0002-pi-gremlins-v1-sdk-rewrite.md`
  - `docs/adr/0002-in-process-sdk-based-gremlin-runtime.md`
  - `docs/plans/pi-gremlins-v1-sdk-rewrite.md`
- **Acceptance criteria:**
  - Tests exist for rejecting old params (`task`, `tasks`, `chain`, `agentScope`, `confirmProjectAgents`).
  - Tests exist for `gremlins` length bounds `1..10`.
  - Test names and fixtures explicitly encode v1 no-popup / no-chain / no-steer intent.
- **Guardrails:**
  - No production logic sneaks into fixture setup.
- **Verification:**
  - targeted Bun test run for new v1 suite once files exist

## Task 1 — Create fresh v1 scaffolding with strict no-legacy-import rule

- **What:** Add fresh source files listed in this plan. New files may import Pi packages and Node built-ins only. They must not import any current gremlin runtime module.
- **Files:** all new v1 source files listed above
- **Acceptance criteria:**
  - `index.ts` is rewritten from zero.
  - New source compiles without importing viewer/chain/runtime legacy modules.
  - No barrel/pass-through compatibility layer introduced.
- **Guardrails:**
  - No copy/paste reuse from old runtime modules.
  - No temporary dual-runtime dispatch in entry file.
- **Verification:**
  - `rg -n 'from "\./(execution|single-agent-runner|invocation-state|result-rendering|viewer|tool-)` extensions/pi-gremlins`
  - `npm run typecheck`

## Task 2 — Implement gremlin discovery and definition parsing

- **What:** Build deterministic discovery for both user and project directories plus frontmatter parser for normalized gremlin definitions.
- **Files:**
  - `gremlin-definition.ts`
  - `gremlin-discovery.ts`
  - `gremlin-schema.ts`
- **Acceptance criteria:**
  - Discovery looks only at `~/.pi/agent/agents` and nearest `.pi/agents`.
  - Duplicate names resolve project over user.
  - Gremlin file raw markdown preserved for prompt assembly.
  - Model / thinking / tools metadata parsed when present.
  - Session-local cache invalidates on file-set mtime/name changes.
- **Guardrails:**
  - No package discovery.
  - No trust-confirm dialog path.
  - No ambient AGENTS walk.
- **Verification:**
  - `bun test extensions/pi-gremlins/gremlin-discovery.test.js`
  - `npm run typecheck`

## Task 3 — Build child session factory with strict isolation

- **What:** Wrap `createAgentSession()` behind fresh helper that constructs isolated in-memory child runtime from parent snapshot values.
- **Files:**
  - `gremlin-prompt.ts`
  - `gremlin-session-factory.ts`
- **Acceptance criteria:**
  - Child session receives parent computed system prompt snapshot.
  - Child session prompt includes raw gremlin markdown and caller context only.
  - Resource loader returns no extensions/skills/prompts/themes/AGENTS.
  - No temp prompt file write path exists.
  - No subprocess spawn path exists.
- **Guardrails:**
  - Do not accidentally use `DefaultResourceLoader` with ambient discovery.
  - Do not bind child extensions.
  - Do not persist child sessions.
- **Verification:**
  - `bun test extensions/pi-gremlins/gremlin-session-factory.test.js`
  - assertions for empty resource loader and isolated session state
  - `npm run typecheck`

## Task 4 — Implement single gremlin runner and event projection

- **What:** Run one child session from prompt to completion, subscribe to child events, and project progress into live gremlin state.
- **Files:**
  - `gremlin-runner.ts`
  - `gremlin-progress-store.ts`
- **Acceptance criteria:**
  - Status moves through queued/start/active/terminal correctly.
  - Tool execution updates are reflected inline through live store.
  - Usage aggregates from assistant messages correctly.
  - Failure and cancel states are distinct.
  - Runner always calls `dispose()` after completion.
- **Guardrails:**
  - No UI formatting logic inside runner.
  - No aggregate multi-gremlin assumptions inside single runner.
- **Verification:**
  - `bun test extensions/pi-gremlins/gremlin-runner.test.js`
  - `npm run typecheck`

## Task 5 — Implement parallel scheduler and structured cancellation

- **What:** Fan out 1..10 gremlins, own one parent abort tree, gather results with `Promise.allSettled`, and finalize cleanly.
- **Files:**
  - `gremlin-scheduler.ts`
  - `gremlin-progress-store.ts`
  - `gremlin-summary.ts`
- **Acceptance criteria:**
  - More than one gremlin starts in parallel immediately.
  - No lower hidden concurrency cap than requested count.
  - Parent abort cancels all running child sessions.
  - Final settle waits for abort/dispose cleanup before tool resolves.
  - Mixed outcomes still preserve successful sibling results.
  - Final aggregate marks tool error if any gremlin failed/canceled.
- **Guardrails:**
  - No fail-fast sibling cancellation on first gremlin failure unless parent abort triggered.
  - No dangling active-session registry after settle.
- **Verification:**
  - `bun test extensions/pi-gremlins/gremlin-scheduler.test.js`
  - tests for 1, 2, 10 gremlins and mixed outcomes
  - tests for abort mid-flight
  - `npm run typecheck`

## Task 6 — Build inline collapsed/expanded renderer with coalesced updates

- **What:** Render live progress directly in tool row. Use Pi built-in expansion instead of popup/viewer.
- **Files:**
  - `gremlin-rendering.ts`
  - `gremlin-render-components.ts`
  - `gremlin-summary.ts`
- **Acceptance criteria:**
  - Collapsed view readable at 1..10 gremlins.
  - Expanded view uses standard tool-row expansion path.
  - No popup/viewer code remains in new renderer.
  - Per-gremlin source and status visible in collapsed state.
  - Running state shows meaningful phase, not only `(running...)`.
  - Render path reuses stable components or cached line computation to avoid churn.
- **Guardrails:**
  - No new custom hotkey handling for expand/collapse.
  - No overlay/widget dependency for main progress UI.
- **Verification:**
  - `bun test extensions/pi-gremlins/gremlin-rendering.test.js`
  - narrow-width and expanded-state snapshots
  - `npm run typecheck`

## Task 7 — Entry-point cutover and legacy deletion

- **What:** Switch live extension entry to v1 implementation and delete legacy runtime files after reference audit.
- **Files:**
  - `index.ts`
  - legacy modules listed above
  - legacy tests no longer relevant
- **Acceptance criteria:**
  - Tool registration exposes only v1 schema.
  - No `/gremlins:view` or `/gremlins:steer` command registration remains.
  - No legacy viewer, chain, or subprocess module referenced anywhere.
  - Deleted files confirmed unused before removal.
- **Guardrails:**
  - Do not leave dead viewer exports or orphaned tests.
  - Verify file references before deleting anything.
- **Verification:**
  - `rg -n 'gremlins:view|gremlins:steer|chain|agentScope|confirmProjectAgents' extensions/pi-gremlins`
  - `rg -n 'spawn\(|pi --mode rpc|pi --mode json|append-system-prompt|mkdtemp|tmp' extensions/pi-gremlins`
  - `npm run typecheck`

## Task 8 — Full regression sweep and dead-code cleanup

- **What:** Finish with end-to-end v1 suite, remove unused imports/exports/helpers, and confirm docs/code alignment.
- **Files:** all rewritten source, tests, README if implementation updates docs later
- **Acceptance criteria:**
  - No unused imports/exports.
  - No dead legacy helper or compatibility shim remains.
  - Full suite passes.
  - Docs and public schema reflect same feature set.
- **Guardrails:**
  - Do not keep dead modules “just in case”.
  - Do not preserve old schema for backwards compatibility unless explicitly requested later.
- **Verification:**
  - `npm run typecheck`
  - `npm test`
  - `git status --short` review for only expected files

## Test Matrix

### Unit tests

- `gremlin-discovery.test.js`
  - both-scope load
  - project overrides user
  - cache hit/miss on file changes
  - package agents excluded
- `gremlin-session-factory.test.js`
  - empty resource loader
  - no AGENTS files
  - no conversation history
  - prompt contains raw markdown + context
- `gremlin-runner.test.js`
  - status transitions
  - usage accumulation
  - tool event projection
  - cancel vs fail distinction
- `gremlin-scheduler.test.js`
  - 1 gremlin
  - N gremlins in parallel
  - mixed results
  - abort all
- `gremlin-rendering.test.js`
  - collapsed snapshots
  - expanded snapshots
  - narrow width
  - running/failed/canceled states
- `index.execute.test.js`
  - full tool execute path
  - schema rejection of legacy params
  - aggregate error semantics

### Explicit regression tests for prior pain

- no nested Pi subprocess spawn in normal runtime path
- no temp prompt file creation
- no popup/view command registration
- no steering command registration
- no chain path anywhere in execute flow
- abort leaves zero active child sessions
- final resolve waits for all child disposals

## Manual QA Matrix

| ID | Scenario | Expected result |
| --- | --- | --- |
| QA-01 | single gremlin run | inline row updates live, final success visible, `Ctrl+O` expands detail |
| QA-02 | 3 gremlins parallel | all start together, statuses update independently, no popup surface |
| QA-03 | one gremlin failure among successes | failed row visible, siblings still finish, aggregate tool result flagged error |
| QA-04 | abort active run | all rows settle canceled, no lingering activity after tool ends |
| QA-05 | duplicate user/project gremlin name | project version wins and row shows `project` source |
| QA-06 | narrow terminal width | collapsed row still shows status + name + short activity |
| QA-07 | expanded inspection | `Ctrl+O` shows context, latest text/tool info, usage, error details |
| QA-08 | no-history isolation | child result clearly reflects only supplied context, not prior parent transcript |

## Risk Register

### Risk 1 — accidental resource leakage into child sessions

- **Where:** `gremlin-session-factory.ts`
- **Why it matters:** violates core user requirement about strict child inputs.
- **Control:** custom full-control `ResourceLoader`; explicit tests for no AGENTS/extensions/prompts/skills/themes/history.

### Risk 2 — same-process child sessions still leave hanging work after abort

- **Where:** `gremlin-runner.ts`, `gremlin-scheduler.ts`
- **Why it matters:** rewrite fails main objective if sessions remain active.
- **Control:** parent-owned abort tree; `Promise.allSettled`; mandatory `abort()` + `dispose()`; active registry assertions in tests.

### Risk 3 — render churn from many streaming updates

- **Where:** `gremlin-progress-store.ts`, `gremlin-rendering.ts`
- **Why it matters:** performance regresses even without subprocesses.
- **Control:** coalesced partial update flushes, stable state records, cached rendering.

### Risk 4 — hidden legacy dependencies survive cutover

- **Where:** `index.ts`, test helpers, imports
- **Why it matters:** old complexity lingers and new runtime is not truly fresh.
- **Control:** strict grep audit, delete legacy modules only after zero-reference proof.

### Risk 5 — same-process model/tool execution changes behavioral expectations

- **Where:** model/tool resolution logic
- **Why it matters:** users may expect prior frontmatter behavior.
- **Control:** keep frontmatter support for model/thinking/tools; document deliberate removals only for scope/mode/viewer features.

## Rollback Strategy

- Land rewrite behind isolated commit slices.
- Keep legacy code untouched until Task 7 cutover passes targeted v1 suite.
- If isolated child sessions fail to meet contract during Tasks 3-5, stop and fix before deleting legacy files.
- After cutover, rollback means revert entire v1 cutover commit, not partial reintroduction of viewer/chain/subprocess code.
- Never hybridize old subprocess runtime with new SDK runtime in shipped code.

## Done Definition

Rewrite is complete only when all are true:

- v1 tool schema is live and legacy schema gone.
- normal runtime path spawns zero nested Pi CLI subprocesses.
- child sessions are isolated exactly to prompt snapshot + raw gremlin markdown + context.
- 1..10 gremlins run correctly, >1 in parallel.
- inline collapsed and expanded views are stable and readable.
- popup/viewer/steer/chain code deleted.
- no dead legacy imports/exports/files remain.
- `npm run typecheck` passes.
- `npm test` passes.

## Self-Review

- Rewrite-first, not patch-first: yes.
- SDK vs RPC decision explicit: yes.
- New public schema explicit: yes.
- No-code-reuse constraint enforced in task order and guardrails: yes.
- Inline `Ctrl+O` path covered without hardcoded new keybinding: yes.
- Dead-code deletion and reference audit explicit: yes.
- Scope trimmed to requested v1 only: yes.
