<!--THIS IS A GENERATED FILE - DO NOT MODIFY DIRECTLY. FOR MANUAL ADJUSTMENTS, CREATE OR UPDATE AGENTS_CUSTOM.md-->
# PI-GREMLINS EXTENSION KNOWLEDGE BASE

**Generated:** 2026-04-22T23:59:59Z
**Commit:** 060fb9b
**Branch:** main

## OVERVIEW
Single-package Pi extension. Owns one v1-only tool at `pi-gremlins` for isolated in-process SDK child sessions, inline progress rendering, and deterministic user+project gremlin discovery.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Tool registration and live update wiring | `index.ts` | registers only `pi-gremlins`; no viewer or steering commands |
| Public schema and result state | `gremlin-schema.ts` | `gremlins: [{ agent, context, cwd? }]`, `1..10`, status/result types |
| Definition parsing and discovery | `gremlin-definition.ts`, `gremlin-discovery.ts` | user `~/.pi/agent/agents` + nearest project `.pi/agents`; project overrides user |
| Prompt and child-session isolation | `gremlin-prompt.ts`, `gremlin-session-factory.ts` | prompt assembly, model/thinking resolution, isolated resource loader |
| Runtime execution | `gremlin-runner.ts`, `gremlin-scheduler.ts`, `gremlin-progress-store.ts` | child event projection, parallel scheduling, cancellation, progress snapshots |
| Inline rendering | `gremlin-render-components.ts`, `gremlin-rendering.ts`, `gremlin-summary.ts` | collapsed/expanded inline output, cached line computation |
| Regression coverage | `gremlin-*.test.js`, `index.execute.test.js`, `index.render.test.js`, `v1-contract-harness.js` | Bun tests for v1 contract, entry wiring, rendering, and runtime behavior |

## CONVENTIONS
- Human-facing copy may say `Gremlins🧌`; runtime/tool/package identifier stays `pi-gremlins`.
- Public invocation shape is `gremlins: [{ agent, context, cwd? }]` only.
- One gremlin runs once. Multiple gremlins start in parallel.
- Discovery loads only user and nearest project gremlins. No package discovery surface.
- Inline progress only. Pi built-in `Ctrl+O` handles expansion.
- JS tests live beside TS source and mock Pi runtime modules inline.

## ANTI-PATTERNS
- Do not reintroduce chain mode, popup viewer, steering command, package discovery, or scope toggles without new PRD/ADR coverage.
- Do not spawn nested Pi CLI subprocesses or write temp prompt files for normal runtime path.
- Do not leak parent extensions, skills, prompts, themes, or AGENTS files into child sessions.
- Do not key live progress by agent name alone; repeated names require stable gremlin ids.
- Do not change tool schema or discovery precedence without updating README, changelog, and v1 tests together.

## COMMANDS
```bash
npm run typecheck
npm test
```

## NOTES
- Main runtime path starts in `index.ts`, then `gremlin-scheduler.ts`, then `gremlin-runner.ts`.
- Rendering work usually spans `gremlin-render-components.ts`, `gremlin-rendering.ts`, and `gremlin-summary.ts`.
- Discovery work usually spans `gremlin-definition.ts` + `gremlin-discovery.ts`.
