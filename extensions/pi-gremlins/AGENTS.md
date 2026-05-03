<!--THIS IS A GENERATED FILE - DO NOT MODIFY DIRECTLY-->
# PI-GREMLINS EXTENSION KNOWLEDGE BASE

**Generated:** 2026-05-03T08:35:15Z
**Commit:** f167e65
**Branch:** main

## OVERVIEW
Pi extension runtime: gremlin child sessions, active steering, primary-agent selection/prompt injection, side-chat overlays, and inline rendering.

## STRUCTURE
```text
extensions/pi-gremlins/
├── agents/       # shared markdown/frontmatter parser
├── gremlins/     # tool execution, discovery, child sessions; read child AGENTS.md
├── primary/      # parent-session primary agent state, controls, persistence, injection
├── side-chat/    # persistent chat/tangent overlays; read child AGENTS.md
├── rendering/    # inline gremlin result text/components
├── shared/       # schema/content/cache/concurrency utilities
└── test/         # Bun JS tests mirroring runtime domains
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Extension registration | `index.ts` | tool, commands, session hooks, shortcut, status |
| Public schema/types | `shared/gremlin-schema.ts` | `gremlins` input and result/activity shapes |
| Agent markdown parsing | `agents/agent-definition.ts` | shared frontmatter/body parser |
| Sub-agent runtime | `gremlins/` | read child AGENTS.md |
| Primary agent runtime | `primary/` | selection state, branch persistence, prompt block injection |
| Side-chat runtime | `side-chat/` | read child AGENTS.md |
| Inline result UI | `rendering/` | cache keys, collapsed/expanded formatter, TUI component |
| Tests | `test/**/*.test.js` | local Pi API mocks; Bun runner |

## CONVENTIONS
- Role split: `agent_type: sub-agent` for gremlin tool; `agent_type: primary` for parent prompt role.
- Project `.pi/agents` beats user agents by same display name after role filtering.
- Symlinked markdown is included for gremlin discovery; ignored for primary discovery.
- Stable gremlin ids are `g1`, `g2`, ...; progress/result state must not key only by agent name.
- Child gremlin sessions receive selected gremlin markdown as system prompt and caller intent/context only.
- Primary prompt blocks are parent-only; strip `pi-gremlins` and legacy `pi-mohawk` blocks before append.
- JS tests sit beside TS modules by domain; avoid external fixtures unless modeling Pi APIs.

## ANTI-PATTERNS
- No nested Pi CLI subprocesses, temp prompt files, chain mode, popup viewer, `/gremlins:view`, package discovery, or scope toggles.
- No parent resource leakage into gremlin child sessions.
- No stale primary selection: missing persisted selection resets to `None` with warning.
- No discovery cache shortcuts that miss same-size/same-mtime content changes.
- No unpaired behavior changes: README, CHANGELOG, tests, and PRD/ADR when warranted.

## COMMANDS
```bash
npm run typecheck
npm test
```

## NOTES
- Hotspots by size/centrality: `gremlins/gremlin-runner.ts`, `gremlins/gremlin-discovery.ts`, `rendering/gremlin-render-components.ts`, `side-chat/side-chat-command.ts`, `index.ts`.
- Start execution bugs at `index.ts` -> `gremlins/gremlin-tool-execution.ts` -> scheduler/runner.
- Start primary bugs in `primary/primary-agent-controls.ts`, persistence, and state.
- Start side-chat bugs in command -> session factory -> overlay/transcript/persistence.
