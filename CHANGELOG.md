# Changelog

All notable changes to this project will be documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- `pi-gremlins` now finalizes child runs on process exit even if `close` never arrives, preserving terminal tool results and parent-session completion for exit-complete gremlin work.

### Changed
- **Immersive Viewer UX and Theming** (PRD-0001, ADR-0001): Overhauled embedded and popup `pi-gremlins` presentation with shared status semantics, `viewerEntries`-driven summaries, clearer source/trust badges, compact live activity rows, narrow-layout hardening, and differentiated tool/result rendering.
- README now leads with gremlin artwork and refreshed package presentation for the updated viewer experience.

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
