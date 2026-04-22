<!--THIS IS A GENERATED FILE - DO NOT MODIFY DIRECTLY. FOR MANUAL ADJUSTMENTS, CREATE OR UPDATE AGENTS_CUSTOM.md-->
# ALWAYS READ THESE FILE(S)
- @AGENTS_CUSTOM.md (optional local override; absent by default)

# PROJECT KNOWLEDGE BASE

**Generated:** 2026-04-22T05:19:12Z
**Commit:** 060fb9b
**Branch:** main

## OVERVIEW
Standalone Pi package. Ships one extension at `extensions/pi-gremlins/` for isolated gremlin subprocess delegation, popup viewer inspection, targeted steering, and Gremlins🧌 human-facing branding over machine-facing `pi-gremlins` identifiers.

## STRUCTURE
```text
pi-gremlins/
├── extensions/pi-gremlins/   # runtime, renderer, viewer, tests
├── docs/adr/                 # architecture records + trigger rubric
├── docs/prd/                 # product scope records + trigger rubric
├── docs/plans/               # implementation plans and QA appendices
├── README.md                 # install, use, naming rules
├── CHANGELOG.md              # unreleased history with PRD/ADR refs
└── package.json              # package shape, scripts, Pi extension manifest
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Package manifest, scripts, publish shape | `package.json` | `pi.extensions` points at `./extensions/pi-gremlins` |
| Install, usage, branding rules | `README.md` | human-facing `Gremlins🧌`; runtime id stays `pi-gremlins` |
| Runtime extension work | `extensions/pi-gremlins/` | almost all code complexity lives here |
| Architectural decisions | `docs/adr/README.md`, `docs/adr/*.md` | ADR-0001 locks session-local semantic presentation direction |
| Product scope + acceptance | `docs/prd/README.md`, `docs/prd/*.md` | PRD-0001 covers viewer/theming overhaul |
| Change history | `CHANGELOG.md` | links notable work back to PRD/ADR ids |

## CONVENTIONS
- Keep repo installable from root. GitHub `pi install` expects `package.json` at repo root.
- Human-facing copy may say `Gremlins🧌`; package/tool/install/runtime identifiers stay `pi-gremlins`.
- TypeScript sources live in `extensions/pi-gremlins/*.ts`; Bun tests live beside them as `*.test.js`.
- Significant user-facing scope change -> write/update PRD first. Significant runtime or architectural boundary change -> write/update ADR first.
- Viewer and invocation state stay session-local. No persistence, archive, or history store without fresh decision docs.

## ANTI-PATTERNS (THIS PROJECT)
- Do not move extension entry away from `./extensions/pi-gremlins` without updating `package.json` manifest wiring.
- Do not rebrand machine-facing ids or schema keys to `Gremlins🧌`; that branding is presentation-only.
- Do not add cross-session storage or viewer history under “UX polish” scope. ADR-0001 explicitly keeps work session-local.
- Do not skip PRD/ADR rubric when work changes product scope or runtime architecture.

## UNIQUE STYLES
- Changelog entries cite PRD/ADR ids for major work.
- Docs use lightweight numbered records under `docs/prd/` and `docs/adr/`.
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
- If task touches behavior, start in `extensions/pi-gremlins/` before touching docs.
