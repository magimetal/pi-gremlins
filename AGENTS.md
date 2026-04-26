<!--THIS IS A GENERATED FILE - DO NOT MODIFY DIRECTLY, FOR MANUAL ADJUSTMENTS UPDATE `AGENTS_CUSTOM.MD`-->
# ALWAYS READ THESE FILE(S)
- @AGENTS_CUSTOM.md

# PROJECT KNOWLEDGE BASE

**Generated:** 2026-04-26T05:03:51Z
**Commit:** 98722c7
**Branch:** main

## OVERVIEW
Standalone Pi package for `Gremlins🧌`: isolated in-process SDK child-session delegation plus primary-agent selection formerly in `pi-mohawk`. Root is the installable package; runtime lives under `extensions/pi-gremlins/`.

## STRUCTURE
```text
pi-gremlins/
├── extensions/pi-gremlins/   # Pi extension runtime, renderers, primary-agent controls, Bun tests
├── docs/                     # PRD/ADR governance plus historical plans
├── README.md                 # public install/use contract
├── CHANGELOG.md              # user-facing release history with PRD/ADR refs
├── package.json              # package manifest, scripts, Pi extension entry
└── tsconfig.json             # strict-ish TS compile surface for extension TS only
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Install/package shape | `package.json` | `pi.extensions` must remain `./extensions/pi-gremlins` |
| Public contract | `README.md` | tool input: `gremlins: [{ intent, agent, context, cwd? }]`, length `1..10` |
| Runtime implementation | `extensions/pi-gremlins/` | read child `AGENTS.md` before edits |
| Product / architecture authority | `docs/` | read child `AGENTS.md`; PRD/ADR beat old plans |
| Release notes | `CHANGELOG.md` | cite PRD/ADR ids for major behavior or architecture changes |
| Tests | `extensions/pi-gremlins/*.test.js` | Bun JS tests beside TS modules |

## CODE MAP
| Symbol | Type | Location | Role |
|--------|------|----------|------|
| `createPiGremlinsExtension` | function | `extensions/pi-gremlins/index.ts` | registers tool, renderers, lifecycle hooks, primary controls |
| `executePiGremlinsTool` | function | `extensions/pi-gremlins/gremlin-tool-execution.ts` | validates invocation and dispatches batch execution |
| `GremlinRequestSchema` | schema | `extensions/pi-gremlins/gremlin-schema.ts` | public tool parameter contract |
| `createGremlinDiscoveryCache` | function | `extensions/pi-gremlins/gremlin-discovery.ts` | sub-agent discovery/cache |
| `createPrimaryAgentDiscoveryCache` | function | `extensions/pi-gremlins/gremlin-discovery.ts` | primary-agent discovery/cache |
| `runGremlinBatch` | function | `extensions/pi-gremlins/gremlin-scheduler.ts` | parallel run orchestration and cancellation |
| `runSingleGremlin` | function | `extensions/pi-gremlins/gremlin-runner.ts` | child session event projection |
| `buildGremlinSessionConfig` | function | `extensions/pi-gremlins/gremlin-session-factory.ts` | child isolation boundary |
| `applyPrimaryAgentPromptInjection` | function | `extensions/pi-gremlins/primary-agent-prompt.ts` | parent-only primary markdown injection |

## CONVENTIONS
- Root stays installable; GitHub `pi install` reads root `package.json`.
- Runtime id stays `pi-gremlins`; `Gremlins🧌` is UI copy only.
- TypeScript source and JS Bun tests live side by side in `extensions/pi-gremlins/`.
- Significant user-facing behavior -> PRD/changelog alignment. Runtime boundary/persistence/pipeline change -> ADR alignment.
- Generated agent docs may be replaced; manual overrides belong in `AGENTS_CUSTOM.md`.

## ANTI-PATTERNS (THIS PROJECT)
- Do not revive nested Pi CLI subprocess runtime, temp prompt files, chain mode, popup viewer, `/gremlins:view`, `/gremlins:steer`, package discovery, or scope toggles.
- Do not leak parent extensions, prompts, themes, skills, AGENTS files, primary-agent markdown, or transcript/history into gremlin child sessions.
- Do not change schema/discovery precedence without README, CHANGELOG, tests, and PRD/ADR alignment when warranted.
- Do not move extension entry from `./extensions/pi-gremlins` without package/readme/test alignment.
- Do not spread `as any`; localized `registerTool(tool as any)` in `index.ts` is the known Pi TypeBox workaround.

## UNIQUE STYLES
- Lightweight numbered PRD/ADR records plus index tables.
- Changelog bullets cite PRD/ADR ids for major scope shifts.
- Tests mock Pi runtime modules locally rather than using external fixtures.
- Telegraphic docs preferred; old plans are history, not live contract.

## COMMANDS
```bash
npm install
npm run typecheck
npm test
npm run check
```

## NOTES
- `.pi/agents` directories are runtime inputs, not package source.
- `node_modules/` and `package-lock.json` dominate size; source concentration is `extensions/pi-gremlins/`.
- Current implementation includes primary-agent merge work; older v1-only plan text can be stale.
