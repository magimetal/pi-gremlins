<!--THIS IS A GENERATED FILE - DO NOT MODIFY DIRECTLY, FOR MANUAL ADJUSTMENTS UPDATE `AGENTS_CUSTOM.MD`-->
# ALWAYS READ THESE FILE(S)
- @AGENTS_CUSTOM.md

# PROJECT KNOWLEDGE BASE

**Generated:** 2026-04-26T00:10:48Z
**Commit:** 1bab6b0
**Branch:** main

## OVERVIEW
Standalone Pi package for `Gremlins🧌`: in-process SDK child-session delegation plus primary-agent selection merged from `pi-mohawk`. Package ships one extension from `extensions/pi-gremlins/`; human-facing branding differs from machine id `pi-gremlins`.

## STRUCTURE
```text
pi-gremlins/
├── extensions/pi-gremlins/   # runtime, renderer, primary-agent controls, Bun tests
├── docs/adr/                 # architecture decisions + index
├── docs/prd/                 # product scope records + index
├── docs/plans/               # execution plans, remediation notes
├── README.md                 # install, use, public contract
├── CHANGELOG.md              # release history with PRD/ADR refs
└── package.json              # scripts, peers, Pi extension manifest
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Package shape | `package.json` | root install; `pi.extensions` -> `./extensions/pi-gremlins` |
| Public usage contract | `README.md` | current schema: `gremlins: [{ intent, agent, context, cwd? }]` |
| Runtime implementation | `extensions/pi-gremlins/` | see child `AGENTS.md` before edits |
| Product scope | `docs/prd/` | PRD-0002 v1 rewrite; PRD-0003 primary-agent merge |
| Architecture scope | `docs/adr/` | ADR-0002 SDK runtime; ADR-0003 unified discovery/prompt injection |
| Plans / historical rationale | `docs/plans/` | long task plans; do not treat old plans as current source of truth over PRD/ADR/README |
| Release notes | `CHANGELOG.md` | cite PRD/ADR ids for user-facing or architecture changes |

## CODE MAP
| Symbol | Type | Location | Role |
|--------|------|----------|------|
| `createPiGremlinsExtension` | function | `extensions/pi-gremlins/index.ts` | Pi extension registration |
| `GremlinRequestSchema` | schema | `extensions/pi-gremlins/gremlin-schema.ts` | public tool input contract |
| `createGremlinDiscoveryCache` | function | `extensions/pi-gremlins/gremlin-discovery.ts` | sub-agent discovery cache |
| `createPrimaryAgentDiscoveryCache` | function | `extensions/pi-gremlins/gremlin-discovery.ts` | primary-agent discovery cache |
| `runGremlinBatch` | function | `extensions/pi-gremlins/gremlin-scheduler.ts` | parallel execution and cancellation |
| `runSingleGremlin` | function | `extensions/pi-gremlins/gremlin-runner.ts` | child session event projection |
| `buildGremlinSessionConfig` | function | `extensions/pi-gremlins/gremlin-session-factory.ts` | isolation boundary |
| `appendPrimaryAgentPromptBlock` | function | `extensions/pi-gremlins/primary-agent-prompt.ts` | parent prompt injection block |

## CONVENTIONS
- Keep repo installable from root; GitHub `pi install` expects root `package.json`.
- Machine ids stay `pi-gremlins`; `Gremlins🧌` is presentation copy only.
- Runtime TypeScript and JS Bun tests live side by side in `extensions/pi-gremlins/`.
- Significant user-facing behavior change -> PRD update first. Runtime boundary change -> ADR update first.
- Generated agent docs may be replaced; manual overrides belong in `AGENTS_CUSTOM.md`.

## ANTI-PATTERNS (THIS PROJECT)
- Do not reintroduce nested Pi CLI subprocess runtime, temp prompt files, chain mode, popup viewer, `/gremlins:view`, `/gremlins:steer`, package discovery, or scope toggles.
- Do not change public schema/discovery precedence without updating README, CHANGELOG, tests, and PRD/ADR when warranted.
- Do not move extension entry from `./extensions/pi-gremlins` without package/readme/test alignment.
- Do not leak parent extensions, prompts, themes, skills, AGENTS files, or conversation history into child sessions.

## UNIQUE STYLES
- Docs use lightweight numbered PRD/ADR records plus README index tables.
- Changelog references PRD/ADR ids for major scope shifts.
- Tests mock Pi runtime modules in local JS harnesses rather than deep external fixtures.

## COMMANDS
```bash
npm install
npm run typecheck
npm test
npm run check
```

## NOTES
- `.pi/agents` directories are runtime inputs, not package source.
- `package-lock.json` inflates line counts; source concentration is `extensions/pi-gremlins/`.
- Current implementation includes primary-agent merge work; older v1-only wording may be stale if copied from historical plans.
