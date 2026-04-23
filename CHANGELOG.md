# Changelog

All notable changes to this project will be documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- **V1 SDK rewrite** (PRD-0002, ADR-0002): `pi-gremlins` now runs gremlins through isolated in-process Pi SDK child sessions instead of nested Pi CLI subprocesses.
- Public tool contract now exposes one invocation shape only: `gremlins: [{ agent, context, cwd? }]` with `1..10` requests and parallel start for multi-gremlin runs.
- Discovery now loads user gremlins from `~/.pi/agent/agents` plus nearest project `.pi/agents` only, with project definitions overriding same-name user definitions.
- Live progress now stays inline in tool row and expands through Pi's standard `Ctrl+O` affordance.
- Embedded rendering now uses stable gremlin ids (`g1`, `g2`, ...), cached line computation, and inline collapsed/expanded summaries built from shared v1 render components.
- Inline progress rendering now keeps collapsed rows compact, flattens multiline previews, prioritizes live tool activity over stale assistant prose, and adds clearer status/text/tool/result separation in tool-row output.
- Pi SDK/runtime deps now target `0.69.0`, package/tool schemas now import `typebox` 1.x instead of `@sinclair/typebox`, and tool registration includes a localized TS inference workaround until upstream typings stop triggering `TS2589` deep-instantiation errors.

### Added
- New v1 runtime modules under `extensions/pi-gremlins/`: schema, definition parsing, discovery cache, prompt builder, isolated session factory, runner, scheduler, progress store, summary builder, and inline renderer.
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
