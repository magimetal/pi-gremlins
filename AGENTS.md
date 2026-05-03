<!--THIS IS A GENERATED FILE - DO NOT MODIFY DIRECTLY-->
# PROJECT KNOWLEDGE BASE

**Generated:** 2026-05-03T08:35:15Z
**Commit:** f167e65
**Branch:** main

## OVERVIEW
Standalone Pi package for `Gremlins🧌`: isolated in-process SDK child delegation, active gremlin steering, primary-agent selection, and side-chat overlays. Root is packaging/docs; runtime is `extensions/pi-gremlins/`.

## STRUCTURE
```text
pi-gremlins/
├── extensions/pi-gremlins/   # Pi extension runtime; read child AGENTS.md
├── docs/                     # PRD/ADR policy, active decisions, historical plans; read child AGENTS.md
├── README.md                 # install + user/runtime contract
├── CHANGELOG.md              # release history with PRD/ADR refs
├── package.json              # package manifest, scripts, Pi extension entry
└── tsconfig.json             # TS check scope: extensions/pi-gremlins/**/*.ts
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Install/package shape | `package.json` | `pi.extensions` must stay `./extensions/pi-gremlins` |
| Public behavior | `README.md` | tool schema, commands, isolation promises |
| Runtime code | `extensions/pi-gremlins/` | gremlins, primary agents, side-chat, rendering |
| Product authority | `docs/prd/` | PRD before significant user-facing scope change |
| Architecture authority | `docs/adr/` | ADR before runtime/persistence/pipeline changes |
| Implementation history | `docs/plans/` | stale until checked against source/README/changelog |

## CODE MAP
| Symbol | Type | Location | Role |
|--------|------|----------|------|
| `createPiGremlinsExtension` | function | `extensions/pi-gremlins/index.ts` | registers tool, commands, hooks, shortcuts |
| `executePiGremlinsTool` | function | `extensions/pi-gremlins/gremlins/gremlin-tool-execution.ts` | validates request, resolves cwd/agent, runs batch |
| `PiGremlinsParams` | schema | `extensions/pi-gremlins/shared/gremlin-schema.ts` | public tool parameter contract |
| `createGremlinDiscoveryCache` | function | `extensions/pi-gremlins/gremlins/gremlin-discovery.ts` | sub-agent discovery/cache |
| `createPrimaryAgentDiscoveryCache` | function | `extensions/pi-gremlins/gremlins/gremlin-discovery.ts` | primary-agent discovery/cache |
| `runSingleGremlin` | function | `extensions/pi-gremlins/gremlins/gremlin-runner.ts` | child session execution + event projection |
| `createGremlinSteerCommandHandler` | function | `extensions/pi-gremlins/gremlins/gremlin-steer-command.ts` | `/gremlins:steer` active-session steering |
| `registerSideChatCommands` | function | `extensions/pi-gremlins/side-chat/side-chat-command.ts` | `/gremlins:chat` and tangent overlay lifecycle |
| `applyPrimaryAgentPromptInjection` | function | `extensions/pi-gremlins/primary/primary-agent-prompt.ts` | parent-only primary markdown injection |

## CONVENTIONS
- Runtime/package/tool id: `pi-gremlins`; human label may be `Gremlins🧌`.
- TypeScript source and Bun JS tests live under `extensions/pi-gremlins/`.
- PRD/changelog required for significant behavior shifts; ADR for runtime boundaries, persistence, or SDK contract changes.
- Agent roles are frontmatter-driven: `sub-agent` for gremlin tool discovery, `primary` for parent prompt selection.

## ANTI-PATTERNS (THIS PROJECT)
- Do not revive nested Pi CLI subprocess runtime, temp prompt files, chain mode, popup viewer, `/gremlins:view`, package discovery, or scope toggles.
- Do not leak parent extensions, prompts, themes, skills, AGENTS files, transcript/history, or primary-agent markdown into gremlin child sessions.
- Do not move extension entry from `./extensions/pi-gremlins` without package/readme/test alignment.
- Do not broaden schema/discovery/command behavior without README, CHANGELOG, tests, and PRD/ADR alignment when warranted.
- Keep `registerTool(tool as any)` localized to `index.ts`; no new broad `as any` spread.

## COMMANDS
```bash
npm install
npm run typecheck
npm test
npm run check
```

## NOTES
- `node_modules/` and `package-lock.json` dominate repository size; source concentration is extension runtime.
- `.pi/agents` directories are runtime inputs, not package source.
- Current PRDs/ADRs through 0008 include side-chat and active steering; older plans can lag.
