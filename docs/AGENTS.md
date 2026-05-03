<!--THIS IS A GENERATED FILE - DO NOT MODIFY DIRECTLY-->
# DOCS KNOWLEDGE BASE

**Generated:** 2026-05-03T08:35:15Z
**Commit:** f167e65
**Branch:** main

## OVERVIEW
Governance layer for product scope, architecture decisions, and implementation history. PRD/ADR records plus README/changelog are current authority; plans require source cross-check.

## STRUCTURE
```text
docs/
├── adr/       # architecture decision records + status index
├── prd/       # product requirement documents + status index
├── plans/     # execution/remediation plans; may be historical
└── gremlins.png
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Product policy/index | `prd/README.md` | trigger rubric, lifecycle, status table |
| Architecture policy/index | `adr/README.md` | trigger rubric, lifecycle, status table |
| SDK runtime boundary | `adr/0002-in-process-sdk-based-gremlin-runtime.md` | in-process child session decision |
| Primary-agent merge | `prd/0003-*.md`, `adr/0003-*.md` | pi-mohawk replacement |
| Side-chat | `prd/0004-*.md`…`prd/0008-*.md`, `adr/0004-*.md`…`adr/0008-*.md` | absorption, overlay persistence, tools policy |
| Active steering | `prd/0006-*.md`, `adr/0006-*.md` | official SDK steering contract |
| Plans/history | `plans/` | useful rationale; not lifecycle authority |

## CONVENTIONS
- PRD before significant user-facing feature/scope/behavior change.
- ADR before runtime architecture, cross-package contract, persistence/config, dependency, or pipeline change.
- Keep `docs/prd/README.md` and `docs/adr/README.md` indexes aligned with document status.
- Cross-link related PRDs and ADRs; cite IDs in changelog for major work.
- Number new docs with next four-digit prefix; leave `0000-template.md` as template/policy source.

## ANTI-PATTERNS
- Do not treat superseded ADR-0001 or PRD-0007 as current authority.
- Do not revive historical non-goals from plans without new PRD/ADR coverage.
- Do not use `docs/plans/` as substitute for PRD/ADR status changes.
- Do not mark PRD/ADR completed/accepted without index updates and cross-links.

## NOTES
- PRD-0002 remains `Draft` in the index despite implemented v1 runtime; verify lifecycle intent before relying on status.
- ADR-0008 supersedes guarded side-chat tool capability ADR-0007.
- README can expose newer behavior details than old implementation plans.
