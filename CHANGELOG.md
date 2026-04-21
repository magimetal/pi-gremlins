# Changelog

All notable changes to this project will be documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- `pi-gremlins` now emits explicit terminal completion updates for single-child `single` and one-step `chain` runs after child exit, so parent flows receive terminal status snapshots before final tool results land.
- `pi-gremlins` now finalizes child runs on process exit even if `close` never arrives, preserving terminal tool results and parent-session completion for exit-complete gremlin work.
- Embedded `pi-gremlins` inline expansion now reuses its rendered text component so newly revealed content keeps viewport anchoring stable instead of forcing a jump to bottom.
- `pi-gremlins` now surfaces child spawn failures, malformed child JSON protocol output, and package gremlin discovery failures with actionable diagnostics instead of degrading into silent or `(no output)` failure states.
- Chain `{previous}` handoff now truncates oversized carry-forward payloads before spawning follow-up gremlin steps, avoiding oversized subprocess task arguments during long chains.

### Changed
- User-facing Gremlins🧌 branding now replaces `pi-gremlins` across inline tool chrome, popup viewer copy, viewer hints, README examples, and slash-command help, while machine-facing package/install identifiers stay `pi-gremlins`.
- `pi-gremlins` now prunes older terminal invocation snapshots while preserving latest and active viewer state, reducing long-session mission-control memory growth.
- Internal subprocess lifecycle and tool text logic now live in focused modules, reducing `index.ts` responsibility concentration and lowering reliability-fix change risk.
- Inline `pi-gremlins` expand hints now advertise `Ctrl+O`, and lair scroll-to-start/end aliases now use `Alt+↑` / `Alt+↓` while preserving `Home` / `End` support.
- **Immersive Viewer UX and Theming** (PRD-0001, ADR-0001): Overhauled embedded and popup `pi-gremlins` presentation with shared status semantics, `viewerEntries`-driven summaries, clearer source/trust badges, compact live activity rows, narrow-layout hardening, and differentiated tool/result rendering.
- README now leads with gremlin artwork, refreshed `Gremlins🧌` user-facing branding, and `/gremlins:view` command guidance while package/install identifiers remain `pi-gremlins`.

### Added
- Product, architecture, and implementation records for viewer overhaul in `docs/prd/0001-pi-gremlins-immersive-theming-and-viewer-ux-overhaul.md`, `docs/adr/0001-semantic-presentation-architecture-for-pi-gremlins-viewer-and-embedded-surfaces.md`, and `docs/plans/pi-gremlins-immersive-theming-viewer-ux-overhaul.md`.
- PRD/ADR index and template scaffolding under `docs/prd/` and `docs/adr/` for future feature and architecture tracking.

## [0.1.0] - 2026-04-20

### Added
- Initial standalone `pi-gremlins` package layout at repository root for GitHub-based `pi install` flows.
- `pi-gremlins` extension source under `extensions/pi-gremlins` with single, parallel, and chain delegation modes.
- Viewer and rendering flows for inspecting latest gremlin run from current session.
- Standalone development setup with local `npm install`, `npm run typecheck`, and `npm test` support.
- README installation and usage documentation for `git:github.com/magimetal/pi-gremlins`.
- Attribution note and metadata acknowledging `nicobailon/pi-subagents` as upstream inspiration.

[Unreleased]: https://github.com/magimetal/pi-gremlins/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/magimetal/pi-gremlins/releases/tag/v0.1.0
