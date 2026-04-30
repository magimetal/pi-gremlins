# Architecture Decision Records — Trigger Rubric and Policy

Lightweight decision log. Captures **why** architectural choices were made, what alternatives existed, and what tradeoffs were accepted.

## Location

All ADRs live in `docs/adr/` as numbered markdown files: `NNNN-short-slug.md`.

## Numbering

Sequential four-digit prefix: `0001`, `0002`, etc. The template lives at `0000-template.md`.

## Trigger Rubric

Write an ADR when a change does **any** of the following:

| Trigger                                              | Example                                                       |
| ---------------------------------------------------- | ------------------------------------------------------------- |
| Introduces a new subsystem or domain boundary        | Adding `apps/api/src/skills/` domain                          |
| Changes cross-package contracts in `packages/shared` | New schema, breaking schema change, new shared type           |
| Adds or replaces an external dependency              | Swapping HTTP client, adding AI SDK provider                  |
| Changes persistence model or config file format      | New JSON store shape, migration from flat file to SQLite      |
| Alters runtime architecture or middleware pipeline   | New global middleware, SSE transport change                   |
| Changes build/test/deploy pipeline in a structural way | Switching test runner, adding CI workflow                   |
| Reverses or materially changes a prior ADR           | Superseding an earlier decision                               |

### Skip ADR when

- Bugfix within existing patterns (no architectural change).
- Isolated UI/API feature inside established boundaries.
- Copy, styling, or polish changes.
- Dependency patch/minor version bumps.
- Refactors that preserve existing architecture (extraction, rename, dead code removal).

**Rule of thumb:** If future-you would ask "why did I do it this way instead of that way?" — write an ADR.

## Lifecycle

| Status                    | Meaning                                                 |
| ------------------------- | ------------------------------------------------------- |
| `Accepted`                | Active decision, currently in effect                    |
| `Deprecated`              | Decision still in codebase but being phased out         |
| `Superseded by ADR-XXXX`  | Replaced by a newer decision; old ADR preserved as-is   |

Solo workflow — no `Proposed` / approval gate. Decisions are written as `Accepted` at creation time.

## Revision Policy

| Situation                          | Action                                                   |
| ---------------------------------- | -------------------------------------------------------- |
| Decision materially changed        | New ADR; mark old one `Superseded by ADR-XXXX`           |
| Clarification, typo, link fix only | Update existing ADR in place                             |
| Decision no longer relevant        | Mark `Deprecated` with date and reason in Status History |

## Linking

Reference ADR IDs in changelog entries for significant changes:

```md
- **Semantic Presentation Architecture** (ADR-0001): Shared viewer event projection and semantic presentation layer.
```

## Index

| ADR  | Title                                                            | Status   | Date       |
| ---- | ---------------------------------------------------------------- | -------- | ---------- |
| 0000 | Template                                                         | Accepted | 2026-04-21 |
| 0001 | Semantic Presentation Architecture for Pi Gremlins Viewer and Embedded Surfaces | Superseded by ADR-0002 | 2026-04-21 |
| 0002 | In-Process SDK-Based Gremlin Runtime                             | Accepted | 2026-04-22 |
| 0003 | Unified Agent Discovery and Primary-Agent Prompt Injection in pi-gremlins | Accepted | 2026-04-25 |
| 0004 | Side-Chat Absorption from pi-gizmo into pi-gremlins              | Proposed | 2026-04-29 |
