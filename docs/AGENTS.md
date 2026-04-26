<!--THIS IS A GENERATED FILE - DO NOT MODIFY DIRECTLY, FOR MANUAL ADJUSTMENTS UPDATE `AGENTS_CUSTOM.MD`-->
# DOCS KNOWLEDGE BASE

**Generated:** 2026-04-26T05:03:51Z
**Commit:** 98722c7
**Branch:** main

## OVERVIEW
Governance layer for product scope, architecture decisions, and implementation history. PRD/ADR records are current authority; plans are execution artifacts unless explicitly newer and aligned.

## STRUCTURE
```text
docs/
├── adr/       # architecture decision records + status index
├── prd/       # product requirement documents + status index
├── plans/     # implementation/remediation plans; verify before treating as current
└── gremlins.png
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Product scope | `prd/README.md`, `prd/000*.md` | status table plus numbered PRDs |
| Architecture boundary | `adr/README.md`, `adr/000*.md` | status table plus numbered ADRs |
| SDK runtime decision | `adr/0002-in-process-sdk-based-gremlin-runtime.md` | current child-session architecture |
| Primary-agent merge | `adr/0003-unified-agent-discovery-and-primary-agent-prompt-injection-in-pi-gremlins.md` | current discovery/prompt-injection architecture |
| V1 runtime scope | `prd/0002-pi-gremlins-v1-sdk-rewrite.md` | narrow gremlin contract and non-goals |
| Primary-agent scope | `prd/0003-primary-agent-selection-and-pi-mohawk-deprecation.md` | `pi-mohawk` replacement scope |
| Implementation history | `plans/` | useful rationale; cross-check source/README/changelog |

## CONVENTIONS
- PRD before significant user-facing scope change.
- ADR before runtime architecture, cross-package contract, persistence/config format, or pipeline change.
- Keep `docs/prd/README.md` and `docs/adr/README.md` status tables aligned with document changes.
- Changelog entries for major work cite related PRD/ADR ids.
- Number new docs with next four-digit prefix; keep `0000-template.md` untouched except template policy updates.

## ANTI-PATTERNS
- Do not treat superseded ADR-0001 as current viewer/runtime architecture.
- Do not revive v1 non-goals from historical plans without new PRD/ADR coverage.
- Do not update `docs/plans/` as substitute for PRD/ADR status changes.
- Do not mark PRD/ADR completed/accepted without updating index table and cross-links.

## NOTES
- PRD-0002 is still marked Draft in the index despite implemented v1 work; verify intended status before relying on lifecycle state.
- ADR-0002 and ADR-0003 are accepted and define current runtime/primary-agent boundaries.
