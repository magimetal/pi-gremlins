<!--THIS IS A GENERATED FILE - DO NOT MODIFY DIRECTLY. FOR MANUAL ADJUSTMENTS, CREATE OR UPDATE AGENTS_CUSTOM.md-->
# ALWAYS READ THESE FILE(S)
- @AGENTS_CUSTOM.md (optional local override; absent by default)

# PROJECT KNOWLEDGE BASE

**Generated:** 2026-04-23T01:40:52Z
**Commit:** 1437df2
**Branch:** main

## OVERVIEW
Standalone Pi package. Ships one v1-only extension at `extensions/pi-gremlins/` for isolated in-process SDK child-session delegation, inline progress rendering, and human-facing `Gremlins🧌` branding over machine-facing `pi-gremlins` identifiers.

## STRUCTURE
```text
pi-gremlins/
├── extensions/pi-gremlins/   # runtime, inline renderer, Bun tests
├── docs/adr/                 # architecture records + status index
├── docs/prd/                 # product scope records + acceptance
├── docs/plans/               # implementation plans, remediation notes
├── README.md                 # install, use, v1 contract
├── CHANGELOG.md              # release history with PRD/ADR refs
└── package.json              # package root, scripts, Pi extension manifest
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Package manifest, scripts, publish shape | `package.json` | `pi.extensions` points at `./extensions/pi-gremlins` |
| Install, usage, branding, public contract | `README.md` | documents `gremlins: [{ agent, context, cwd? }]` and v1 limits |
| Runtime entry and live updates | `extensions/pi-gremlins/index.ts` | registers only `pi-gremlins`; clears discovery cache on session lifecycle |
| Discovery + precedence | `extensions/pi-gremlins/gremlin-discovery.ts`, `gremlin-definition.ts` | loads user + nearest project gremlins; project wins on name collision |
| Session isolation | `extensions/pi-gremlins/gremlin-session-factory.ts`, `gremlin-prompt.ts` | builds SDK child sessions with isolated resources and prompt-only context |
| Scheduling, progress, result summaries | `extensions/pi-gremlins/gremlin-scheduler.ts`, `gremlin-runner.ts`, `gremlin-progress-store.ts`, `gremlin-summary.ts` | parallel start, cancellation, aggregate status |
| Inline rendering | `extensions/pi-gremlins/gremlin-render-components.ts`, `gremlin-rendering.ts` | collapsed and expanded tool-row output; no popup viewer |
| Architecture and scope records | `docs/adr/0002-*.md`, `docs/prd/0002-*.md` | ADR-0002 locks SDK runtime; PRD-0002 tracks v1 rewrite scope |
| Change history | `CHANGELOG.md` | unreleased section records rewrite and removals |

## CONVENTIONS
- Keep repo installable from root. GitHub `pi install` expects `package.json` at repo root.
- Human-facing copy may say `Gremlins🧌`; package/tool/install/runtime identifiers stay `pi-gremlins`.
- Public tool contract is `gremlins: [{ agent, context, cwd? }]` only, length `1..10`.
- TypeScript runtime lives in `extensions/pi-gremlins/*.ts`; Bun tests stay beside modules as `*.test.js`.
- Significant user-facing scope change -> write/update PRD first. Significant runtime or architectural boundary change -> write/update ADR first.
- Runtime state stays session-local. No persistence, archive, or cross-session history without fresh decision docs.

## ANTI-PATTERNS (THIS PROJECT)
- Do not reintroduce nested Pi CLI subprocess runtime, temp prompt files, or legacy mode matrix. ADR-0002 rejected that architecture.
- Do not add chain mode, popup viewer, `/gremlins:view`, targeted steering, package discovery, or scope toggles under “polish”.
- Do not rebrand machine-facing ids or schema keys to `Gremlins🧌`; branding is presentation-only.
- Do not move extension entry away from `./extensions/pi-gremlins` without updating `package.json`, README install flow, and tests.
- Do not skip PRD/ADR rubric when work changes product scope or runtime architecture.

## UNIQUE STYLES
- Changelog entries cite PRD/ADR ids for major work.
- Docs use lightweight numbered records under `docs/prd/` and `docs/adr/`, with README index files.
- Tests mock Pi runtime modules directly inside Bun tests; extension-level behavior coverage matters more than deep mocking layers.

## COMMANDS
```bash
npm install
npm run typecheck
npm test
npm run check
```

## NOTES
- Ignore `.pi-lens/` cache noise unless changing local analysis artifacts.
- Hidden `.pi/agents` directories are runtime inputs, not package source.
- Current architecture center: `extensions/pi-gremlins/`, ADR-0002, PRD-0002.
- If task touches runtime behavior, start in `extensions/pi-gremlins/` before touching docs.
