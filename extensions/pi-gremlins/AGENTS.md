<!--THIS IS A GENERATED FILE - DO NOT MODIFY DIRECTLY, FOR MANUAL ADJUSTMENTS UPDATE `AGENTS_CUSTOM.MD`-->
# PI-GREMLINS EXTENSION KNOWLEDGE BASE

**Generated:** 2026-04-26T05:03:51Z
**Commit:** 98722c7
**Branch:** main

## OVERVIEW
Pi extension runtime for gremlin sub-agent execution, inline progress rendering, role-aware agent discovery, and parent-session primary-agent selection.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Extension registration | `index.ts` | tool, renderer, lifecycle hooks, `/mohawk`, shortcut, status |
| Tool execution flow | `gremlin-tool-execution.ts` | invocation normalization, request validation, cwd handling |
| Public schema/types | `gremlin-schema.ts` | `gremlins` array contract and run/result shapes |
| Shared agent parsing | `agent-definition.ts` | frontmatter/body parsing for both roles |
| Sub-agent parsing | `gremlin-definition.ts` | accepts `agent_type: sub-agent` only |
| Primary parsing | `primary-agent-definition.ts` | accepts `agent_type: primary` plus persisted selection shape |
| Discovery/cache | `gremlin-discovery.ts` | user + nearest project `.pi/agents`; project wins by same name |
| Child prompt/session | `gremlin-prompt.ts`, `gremlin-session-factory.ts` | prompt-only context; empty child resources |
| Execution path | `gremlin-scheduler.ts`, `gremlin-runner.ts`, `gremlin-progress-store.ts` | parallel starts, aborts, event/activity projection |
| Rendering path | `gremlin-render-components.ts`, `gremlin-rendering.ts`, `gremlin-summary.ts` | collapsed/expanded inline text and cache keys |
| Primary state/UI | `primary-agent-state.ts`, `primary-agent-controls.ts`, `primary-agent-persistence.ts`, `primary-agent-prompt.ts` | selection, persistence, prompt block injection |
| Test harness | `v1-contract-harness.js`, `test-helpers.js`, `*.test.js` | Bun tests with local Pi API mocks |

## CONVENTIONS
- Runtime/package/tool ids remain `pi-gremlins`; human labels may say `Gremlins🧌`.
- Role split is frontmatter-driven: `sub-agent` for gremlins, `primary` for parent-session agents.
- Repeated gremlin requests require stable ids (`g1`, `g2`, ...); never key progress only by agent name.
- Child sessions get selected gremlin markdown as system prompt and caller intent/context as user prompt only.
- Primary-agent prompt blocks are parent-only; strip existing `pi-gremlins` and legacy `pi-mohawk` blocks before appending.
- Keep `registerTool(tool as any)` localized to `index.ts` until Pi 0.69.0 / TypeBox typing no longer hits TS2589.
- Tests stay JS beside TS modules; use local harness/mocks over external Pi fixtures.

## ANTI-PATTERNS
- No nested Pi CLI subprocesses or temp prompt files in normal runtime.
- No chain mode, popup viewer, targeted steering, package discovery, or scope toggles.
- No parent resource leakage into child sessions: extensions, skills, prompts, themes, AGENTS files, transcript/history, primary-agent markdown.
- No schema/discovery changes without paired README, CHANGELOG, tests, and governance docs when scope changes.
- No stale primary-agent injection: missing persisted selection resets to `None` with warning.
- No discovery cache shortcuts that miss same-size/same-mtime content changes.

## COMMANDS
```bash
npm run typecheck
npm test
```

## NOTES
- Large hotspots: `gremlin-runner.ts`, `gremlin-discovery.ts`, `gremlin-render-components.ts`, `index.ts`, `gremlin-session-factory.ts`.
- Start execution bugs at `index.ts` -> `gremlin-tool-execution.ts` -> `gremlin-scheduler.ts` -> `gremlin-runner.ts`.
- Start rendering bugs at `gremlin-render-components.ts`; `gremlin-rendering.ts` styles/caches final text.
- Start primary-agent bugs at `primary-agent-controls.ts`, `primary-agent-persistence.ts`, and `primary-agent-state.ts`.
