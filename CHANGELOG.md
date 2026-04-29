# Changelog

All notable changes to this project will be documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- **`/mohawk` renamed to `/gremlins:primary`** (issue #45): the `/mohawk` slash command is replaced by `/gremlins:primary`, consolidating primary-agent selection under the `pi-gremlins` tool namespace; all underlying behavior, shortcut cycling, and session state are preserved.
- README documentation now reflects the current `pi-gremlins` contract, discovery precedence, runtime behavior, primary-agent controls, and test command details.
- Generated `AGENTS.md` guidance for the root, docs, and extension scopes now reflects the current primary-agent, runtime, and governance boundaries.
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
- `pi-gremlins` maintainability improved by extracting shared cache helpers, tool execution flow, and gremlin runner event projection into smaller focused modules/functions without changing the public tool contract.

### Fixed
- **Primary-agent selection persistence** (PRD-0003, ADR-0003, issue #42): `/mohawk` selections, shortcut cycling, and cleared primary-agent state now persist in project-local `.pi/settings.json`, restore in fresh Pi sessions, and reset with a warning if the saved primary agent disappears.
- **Gremlin child prompt isolation** (PRD-0002, ADR-0002, ADR-0003, issue #41): child sessions now use selected sub-agent markdown as their system prompt and no longer receive parent prompt snapshots, primary-agent prompt blocks, active primary-agent markdown, or orchestration rules.
- Hardened gremlin runtime reliability around child-session cleanup, abort handling, discovery file failures, request validation, CRLF gremlin frontmatter parsing, unresolved model selection, and parent-abort progress updates.
- Repaired reliability audit findings for renderer cache uniqueness, same-size agent discovery changes, corrupt primary-agent settings recovery, effective request-cwd discovery, and ambiguous gremlin model reporting.

### Added
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
