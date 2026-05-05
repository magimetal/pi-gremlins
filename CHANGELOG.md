# Changelog

All notable changes to this project will be documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- `extensions/pi-gremlins` source and test files are reorganized into feature folders (`agents`, `gremlins`, `primary`, `rendering`, `shared`, `side-chat`, and `test`) while preserving the package entry point at `./extensions/pi-gremlins`.
- **Persistent overlay side-chat** (PRD-0005, ADR-0005, issue #49): `/gremlins:chat` and `/gremlins:tangent` now open persistent multi-turn overlays instead of inline one-shot responses; `:new` variants reset only the selected mode while preserving chat/tangent isolation.
- **`/mohawk` renamed to `/gremlins:primary`** (issue #45): the `/mohawk` slash command is replaced by `/gremlins:primary`, consolidating primary-agent selection under the `pi-gremlins` tool namespace; all underlying behavior, shortcut cycling, and session state are preserved.
- README documentation now reflects the current `pi-gremlins` contract, discovery precedence, runtime behavior, primary-agent controls, and test command details.
- Generated `AGENTS.md` guidance for the root, docs, extension, gremlins runtime, and side-chat scopes now reflects the current primary-agent, runtime, side-chat, and governance boundaries.
- **Primary-agent selection and pi-mohawk deprecation path** (PRD-0003, ADR-0003, issue #39): `pi-gremlins` now includes primary-agent discovery, `/mohawk` selection, `Ctrl+Shift+M` cycling, session-scoped state, status UX, and `before_agent_start` prompt injection previously owned by `pi-mohawk`.
- **V1 SDK rewrite** (PRD-0002, ADR-0002): `pi-gremlins` now runs gremlins through isolated in-process Pi SDK child sessions instead of nested Pi CLI subprocesses.
- Public tool contract now exposes one invocation shape only: `gremlins: [{ intent, agent, context, cwd? }]` with `1..10` requests and parallel start for multi-gremlin runs; `intent`, `agent`, and `context` are required non-empty strings.
- Discovery now loads only markdown agent files with `agent_type: sub-agent` from `~/.pi/agent/agents` plus nearest project `.pi/agents`, with typed project definitions overriding same-name typed user definitions.
- Live progress now stays inline in tool row and expands through Pi's standard `Ctrl+O` affordance.
- Embedded rendering now uses stable gremlin ids (`g1`, `g2`, ...), cached line computation, and inline collapsed/expanded summaries built from shared v1 render components.
- Inline progress rendering now shows collapsed gremlin context, the three latest activity rows, usage rows, flattened multiline previews, and clearer status/text/tool/result separation in tool-row output.
- Pi SDK/runtime deps now target `0.69.0`, package/tool schemas now import `typebox` 1.x instead of `@sinclair/typebox`, and tool registration includes a localized TS inference workaround until upstream typings stop triggering `TS2589` deep-instantiation errors.
- Gremlin runner usage now reports current context-window token usage from Pi SDK session context instead of summing cumulative per-turn `totalTokens`, preventing inflated `contextTokens` in multi-turn runs.
- Runtime cache hot paths now use compact render cache keys, per-entry render segment reuse, memoized discovery directory listings, reused file fingerprints, in-flight discovery sharing, coalesced streaming text updates, and truncated activity previews to reduce repeated string, filesystem, and UI churn during active gremlin runs.
- Gremlin batch scheduling and discovery file processing now use bounded internal concurrency, collapsed inline rendering keeps preview output bounded, and shared helper modules reduce duplicated text/cache handling without changing the public tool contract.
- `pi-gremlins` maintainability improved by extracting shared cache helpers, tool execution flow, and gremlin runner event projection into smaller focused modules/functions without changing the public tool contract.

### Fixed
- **Expanded inline subagent output** (issue #66): expanded gremlin inline details now show the full available subagent output instead of clipping expanded text fields to a short preview.
- Side-chat transcript persistence now queues pending chat/tangent questions per mode so overlapping prompts are saved with the correct completed answer.
- **Active steering visibility** (issue #63): `/gremlins:steer` now records queued and SDK-rejected steering attempts in the inline gremlin activity stream and documents a live repro plus install-version drift checks.
- **Inline gremlin render line clamp** (issue #61): collapsed inline sub-agent results now enforce the preview visual-line limit during high-volume output bursts, including narrow-width wrapped lines.
- **Side-chat overlay UX and realtime rendering** (PRD-0005, ADR-0005, issue #54): overlay now has explicit border/gutters, 80% viewport-height sizing with internal transcript scrolling, reliable Escape close handling, and render invalidation for incoming child-session updates without keyboard input.
- **Full Gremlin final messages in tool results** (issue #50): parent agents now receive each terminal gremlin's full final output or error text in model-visible tool result content while preserving collapsed inline summary previews.
- **Primary-agent selection persistence** (PRD-0003, ADR-0003, issue #42): `/mohawk` selections, shortcut cycling, and cleared primary-agent state now persist in project-local `.pi/settings.json`, restore in fresh Pi sessions, and reset with a warning if the saved primary agent disappears.
- **Gremlin child prompt isolation** (PRD-0002, ADR-0002, ADR-0003, issue #41): child sessions now use selected sub-agent markdown as their system prompt and no longer receive parent prompt snapshots, primary-agent prompt blocks, active primary-agent markdown, or orchestration rules.
- Hardened gremlin runtime reliability around child-session cleanup, abort handling, discovery file failures, request validation, CRLF gremlin frontmatter parsing, unresolved model selection, and parent-abort progress updates.
- Repaired reliability audit findings for renderer cache uniqueness, same-size agent discovery changes, corrupt primary-agent settings recovery, effective request-cwd discovery, and ambiguous gremlin model reporting.

### Added
- **Side-chat skill prompt support** (PRD-0008, ADR-0008, issue #59): `/gremlins:chat` and `/gremlins:tangent` can now load fresh child-session skills and diagnostics through the side-chat child resource-loader boundary, enabling SDK-native skill guidance while keeping parent-loaded skills and legacy side-chat skill paths isolated.
- **Side-chat SDK default and extension tools** (PRD-0008, ADR-0008, issue #57): `/gremlins:chat` and `/gremlins:tangent` now omit explicit child-session tools so SDK default built-ins apply, while enabled extension custom tools can load through a fresh child resource loader. Side-chat-specific `.pi/settings.json` allowlists/configuration are removed/ignored; overlay persistence and chat/tangent isolation are retained.
- **Active gremlin session steering** (PRD-0006, ADR-0006, issue #53): `/gremlins:steer <G-id> <message>` now queues steering directly through the active child `AgentSession.steer(message)` API, with lifecycle-scoped registry cleanup, case-insensitive ids, duplicate-id ambiguity rejection, and fail-closed handling for stale or terminal sessions.
- **Side-chat absorbed from pi-gizmo** (PRD-0004, ADR-0004, issue #47): pi-gremlins now ships `/gremlins:chat` (parent-transcript snapshot) and `/gremlins:tangent` (clean child session), rebuilt on the existing in-process SDK runtime with zero tools and inline rendering. See README "Side-chat" section for the pi-gizmo migration table.
- Generated agent guidance now covers root, docs, and extension scopes so contributors get current PRD/ADR, primary-agent, and runtime boundaries before editing.
- Shared role-aware agent parsing/discovery modules now load `agent_type: sub-agent` gremlins and `agent_type: primary` primary agents from user/project agent directories while preserving strict role separation and project-over-user precedence.
- Primary-agent state and prompt helpers persist new selections as `pi-gremlins-primary-agent`, read legacy `pi-mohawk-primary-agent` entries for migration, and strip legacy prompt blocks before appending the selected primary markdown.
- New v1 runtime modules under `extensions/pi-gremlins/`: schema, definition parsing, discovery cache, prompt builder, isolated session factory, runner, scheduler, progress store, summary builder, and inline renderer.
- Child prompt framing now separates caller intent from caller context so gremlins see delegation rationale apart from task details.
- Focused v1 contract coverage for schema, discovery, session isolation, runner projection, scheduler cancellation, rendering, and entry-point execution.
- `extensions/pi-gremlins/AGENTS_CUSTOM.md` override documenting current v1-only runtime boundaries until generated agent docs are refreshed.

### Removed
- Legacy chain mode, popup viewer, `/gremlins:view`, targeted steering, package-agent discovery, scope toggles, subprocess protocol handling, and temp prompt file flow.
- Legacy runtime and viewer modules removed from `extensions/pi-gremlins/`, along with obsolete tests tied to deleted surface area.

## [0.1.0] - 2026-04-20

### Added
- Initial standalone `pi-gremlins` package layout at repository root for GitHub-based `pi install` flows.
- `pi-gremlins` extension source under `extensions/pi-gremlins` with single, parallel, and chain delegation modes.
- Viewer and rendering flows for inspecting latest gremlin run from current session.
- Standalone development setup with local `npm install`, `npm run typecheck`, and `npm test` support.
- README installation and usage documentation for `git:github.com/magimetal/pi-gremlins`.

[Unreleased]: https://github.com/magimetal/pi-gremlins/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/magimetal/pi-gremlins/releases/tag/v0.1.0
