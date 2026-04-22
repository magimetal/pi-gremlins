<!--THIS IS A GENERATED FILE - DO NOT MODIFY DIRECTLY. FOR MANUAL ADJUSTMENTS, CREATE OR UPDATE AGENTS_CUSTOM.md-->
# PI-GREMLINS EXTENSION KNOWLEDGE BASE

**Generated:** 2026-04-22T05:19:12Z
**Commit:** 060fb9b
**Branch:** main

## OVERVIEW
Single-package Pi extension. Owns tool schema, agent discovery, subprocess orchestration, embedded rendering, popup viewer, and targeted steering.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Tool registration, commands, overlay lifecycle | `index.ts` | registers tool, `/gremlins:view`, `/gremlins:steer`, live snapshot publishing |
| Agent lookup and source precedence | `agents.ts`, `package-discovery.ts` | user/project/package merge, nearest `.pi/agents`, cache freshness |
| Single/parallel/chain execution | `execution-modes.ts`, `single-agent-runner.ts` | concurrency limits, `{previous}` carry-forward, child RPC/stdin steering |
| Shared result semantics | `execution-shared.ts`, `invocation-state.ts` | status model, derived render data, snapshot cloning/pruning |
| Embedded render output | `result-rendering.ts`, `tool-call-formatting.ts`, `tool-text.ts` | summaries, viewer hints, tool/result formatting |
| Popup viewer UI | `viewer-overlay.ts`, `viewer-body-cache.ts`, `viewer-result-navigation.ts`, `viewer-open-action.ts` | chrome, caching, wrapping, navigation, open/focus behavior |
| Regression coverage | `*.test.js`, `test-helpers.js` | Bun tests with mocked Pi/TUI runtime modules |

## CONVENTIONS
- Default `agentScope` is `user`. Project agents require `agentScope: "project" | "both"` plus trust confirmation.
- Human-facing branding says `Gremlins🧌`; schema fields stay `agent`, `task`, `tasks`, `chain`, `agentScope`, `confirmProjectAgents`, `cwd`.
- `viewerEntries` are canonical presentation feed when present. Embedded and popup surfaces must stay semantically aligned.
- Invocation state is session-local only. Registry pruning is deliberate; no persistence/history layer.
- JS tests live beside TS sources and inline-mock upstream Pi packages.

## ANTI-PATTERNS
- Do not change tool params, command names, or user-visible routing rules without updating README, tool text, and tests together.
- Do not add render semantics in popup only or embedded only. Parity across both surfaces required.
- Do not bypass chain truncation or concurrency guardrails casually. Long carry-forward payloads and too many children will break runtime behavior.
- Do not hide source/trust cues behind decorative copy. Agent origin and project-agent participation are operator safety signals.
- Do not ship viewer, lifecycle, or rendering changes without touching affected `*.test.js` coverage.

## COMMANDS
```bash
npm run typecheck
npm test
```

## NOTES
- Largest hotspots: `single-agent-runner.ts`, `result-rendering.ts`, `execution-shared.ts`, `index.ts`, `execution-modes.ts`.
- Viewer work usually spans `index.ts` + `result-rendering.ts` + `viewer-*` + snapshot/navigation tests.
- Discovery work usually spans `agents.ts` + `package-discovery.ts` + README naming/copy expectations.
