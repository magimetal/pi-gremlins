<!--THIS IS A GENERATED FILE - DO NOT MODIFY DIRECTLY, FOR MANUAL ADJUSTMENTS UPDATE `AGENTS_CUSTOM.MD`-->
# PI-GREMLINS EXTENSION KNOWLEDGE BASE

**Generated:** 2026-04-26T00:10:48Z
**Commit:** 1bab6b0
**Branch:** main

## OVERVIEW
Extension runtime for `pi-gremlins`: gremlin sub-agent execution, inline progress rendering, unified agent discovery, and parent-session primary-agent selection.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Extension registration | `index.ts` | registers tool, renderers, lifecycle hooks, primary-agent UI surfaces |
| Tool schema and result types | `gremlin-schema.ts` | `gremlins: [{ intent, agent, context, cwd? }]`, length `1..10` |
| Shared markdown parsing | `agent-definition.ts` | frontmatter/body parsing used by both roles |
| Gremlin definition parsing | `gremlin-definition.ts` | `agent_type: sub-agent` only |
| Primary definition parsing | `primary-agent-definition.ts` | `agent_type: primary` only; persisted selection shape |
| Discovery/cache precedence | `gremlin-discovery.ts` | user + nearest project `.pi/agents`; project wins by name |
| Child prompt/session | `gremlin-prompt.ts`, `gremlin-session-factory.ts` | prompt-only context; empty child resources |
| Execution path | `gremlin-scheduler.ts`, `gremlin-runner.ts`, `gremlin-progress-store.ts` | parallel starts, abort handling, event/activity projection |
| Rendering path | `gremlin-render-components.ts`, `gremlin-rendering.ts`, `gremlin-summary.ts` | collapsed/expanded inline rows and summary text |
| Primary-agent state/UI | `primary-agent-state.ts`, `primary-agent-controls.ts`, `primary-agent-prompt.ts` | selection, `/mohawk`, `Ctrl+Shift+M`, prompt block injection |
| Test harness | `v1-contract-harness.js`, `test-helpers.js`, `*.test.js` | Bun tests mock Pi runtime modules locally |

## CONVENTIONS
- Runtime ids remain `pi-gremlins`; labels may say `Gremlins🧌`.
- Role split is frontmatter-driven: `sub-agent` for gremlins, `primary` for parent-session agent.
- Repeated gremlin names require stable ids (`g1`, `g2`, ...); never key progress only by agent name.
- Keep `registerTool(tool as any)` localized to `index.ts` until Pi TypeBox typing no longer needs it.
- Tests stay as JS beside TS modules and use the local harness for Pi API mocks.

## ANTI-PATTERNS
- No nested Pi CLI subprocesses or temp prompt files in normal runtime.
- No chain mode, popup viewer, targeted steering, package discovery, or scope toggles.
- No parent resource leakage into child sessions: extensions, skills, prompts, themes, AGENTS files, transcript/history.
- No schema/discovery changes without paired README, CHANGELOG, tests, and governance docs when scope changes.
- No primary-agent prompt injection without stripping/replacing prior `pi-gremlins primary agent` blocks first.

## COMMANDS
```bash
npm run typecheck
npm test
```

## NOTES
- Start execution debugging in `index.ts` -> `gremlin-scheduler.ts` -> `gremlin-runner.ts`.
- Start rendering debugging in `gremlin-render-components.ts`; `gremlin-rendering.ts` mostly styles/caches final text.
- Start primary-agent bugs in `primary-agent-controls.ts` for UI action and `primary-agent-state.ts` for transcript restore.
