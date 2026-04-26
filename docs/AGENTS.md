<!--THIS IS A GENERATED FILE - DO NOT MODIFY DIRECTLY, FOR MANUAL ADJUSTMENTS UPDATE `AGENTS_CUSTOM.MD`-->
# DOCS KNOWLEDGE BASE

**Generated:** 2026-04-26T00:10:48Z
**Commit:** 1bab6b0
**Branch:** main

## OVERVIEW
Governance docs for product scope, architecture decisions, and implementation plans. Treat PRD/ADR records as current authority over historical plans when they conflict.

## STRUCTURE
```text
docs/
├── adr/       # architecture decision records + status index
├── prd/       # product requirement documents + status index
├── plans/     # implementation and remediation plans
└── gremlins.png
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Product scope question | `prd/README.md`, `prd/000*.md` | status table plus numbered PRDs |
| Architecture boundary question | `adr/README.md`, `adr/000*.md` | status table plus numbered ADRs |
| SDK runtime decision | `adr/0002-in-process-sdk-based-gremlin-runtime.md` | rejects subprocess/popup architecture |
| Unified discovery / primary-agent merge | `adr/0003-unified-agent-discovery-and-primary-agent-prompt-injection-in-pi-gremlins.md` | current primary-agent architecture |
| V1 runtime scope | `prd/0002-pi-gremlins-v1-sdk-rewrite.md` | narrow gremlin contract and non-goals |
| Primary-agent scope | `prd/0003-primary-agent-selection-and-pi-mohawk-deprecation.md` | pi-mohawk deprecation / integration |
| Implementation history | `plans/` | long-form execution records; verify against source before acting |

## CONVENTIONS
- Add or update PRD before significant user-facing scope changes.
- Add or update ADR before runtime architecture, cross-package contract, persistence/config format, or pipeline changes.
- Keep README index tables aligned with document status changes.
- Changelog entries for major work cite related PRD/ADR ids.

## ANTI-PATTERNS
- Do not treat superseded ADR-0001 as current viewer architecture.
- Do not revive features listed as v1 non-goals from old plans without new PRD/ADR coverage.
- Do not update plans as substitute for PRD/ADR status changes.
