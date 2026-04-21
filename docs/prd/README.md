# Product Requirement Documents — Trigger Rubric and Policy

Lightweight product scope log. Captures **what** to build, **who** it's for, and **when it's done** — before implementation starts.

PRDs complement ADRs: a PRD defines product scope and acceptance criteria, an ADR captures significant technical decisions made during that build.

## Location

All PRDs live in `docs/prd/` as numbered markdown files: `NNNN-short-slug.md`.

## Numbering

Sequential four-digit prefix: `0001`, `0002`, etc. The template lives at `0000-template.md`.

## Trigger Rubric

Write a PRD when a change does **any** of the following:

| Trigger                                                  | Example                                                        |
| -------------------------------------------------------- | -------------------------------------------------------------- |
| New user-facing feature or surface                       | Skills management page, prompt editor, session rename          |
| New domain or subsystem with product behavior            | Projects domain, Tasks domain, Agent orchestration             |
| Significant behavior change to existing feature          | Changing session streaming model, adding multi-model support   |
| Cross-domain feature spanning API + Web                  | Tool config system (schemas + API + settings + assistant UI)   |
| Feature with non-obvious scope boundaries                | "What does v1 of Projects actually include?"                   |

### Skip PRD when

- Bugfix restoring existing behavior (no new scope).
- Refactor or extraction (no user-facing change).
- Polish, styling, or copy changes.
- Dependency updates.
- Infrastructure-only changes (those get ADRs if significant, not PRDs).

**Rule of thumb:** If you'd start building and realize mid-way "wait, what exactly am I building?" — write a PRD first.

## Lifecycle

| Status                      | Meaning                                                   |
| --------------------------- | --------------------------------------------------------- |
| `Draft`                     | Requirements being defined, not yet committed to          |
| `Active`                    | Committed scope, implementation underway or planned       |
| `Completed`                 | All acceptance criteria met, feature shipped              |
| `Deferred`                  | Intentionally postponed with reason                       |
| `Cancelled`                 | Will not be built, with reason                            |
| `Superseded by PRD-XXXX`    | Scope replaced by a new PRD; old PRD preserved as-is      |

PRDs start as `Draft` during scope definition. Move to `Active` when implementation begins.

## Revision Policy

| Situation                              | Action                                                     |
| -------------------------------------- | ---------------------------------------------------------- |
| Scope materially changes mid-build     | New PRD; mark old one `Superseded by PRD-XXXX`             |
| Scope refined/narrowed (same intent)   | Update existing PRD in place, note in Revision History     |
| Feature shipped                        | Mark `Completed` with date                                 |
| Feature abandoned                      | Mark `Cancelled` with reason                               |
| Feature postponed                      | Mark `Deferred` with reason and revisit trigger            |

## Cross-Linking with ADRs

PRDs and ADRs reference each other:
- PRD links related ADRs in its **Technical Surface** section.
- ADR links related PRDs in its **Related** metadata or **Context** section.

```md
## Technical Surface
- **Related ADRs:** ADR-0003 (plugin registry architecture)
```

## Linking in Changelog

Reference PRD IDs in changelog entries for feature work:

```md
- **Skills Management System** (PRD-0002): Discovering, creating, and managing AI assistant skills...
```

## Index

Maintain in `docs/prd/README.md`:

| PRD  | Title                                                     | Status | Date       |
| ---- | --------------------------------------------------------- | ------ | ---------- |
| 0000 | Template                                                  | Active | 2026-04-21 |
| 0001 | Pi Gremlins Immersive Theming and Viewer UX Overhaul      | Completed | 2026-04-21 |
