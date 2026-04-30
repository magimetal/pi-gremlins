# PRD-0005: Persistent Overlay Side-Chat

- **Status:** Completed
- **Date:** 2026-04-30
- **Author:** Magi Metal
- **Related:** GitHub issue [#49](https://github.com/magimetal/pi-gremlins/issues/49), [PRD-0004](0004-pi-gremlins-side-chat-absorption-and-pi-gizmo-deprecation.md), [ADR-0005](../adr/0005-persistent-overlay-side-chat.md), [ADR-0004](../adr/0004-side-chat-absorption-from-pi-gizmo.md), [ADR-0003](../adr/0003-unified-agent-discovery-and-primary-agent-prompt-injection-in-pi-gremlins.md)
- **Supersedes:** PRD-0004 side-chat UX decisions for fresh-per-invocation inline side-chat.

## Problem Statement

PRD-0004 intentionally shipped a conservative side-chat v1: `/gremlins:chat <prompt>` and `/gremlins:tangent <prompt>` ran fresh zero-tool child sessions and rendered one answer inline. That removed pi-gizmo's legacy runtime but also removed the actual working shape users wanted: a persistent side conversation that can stay open while the parent session continues.

Issue #49 requests the inverse UX: persistent multi-turn side-chat threads, surfaced in a canonical Pi overlay, surviving reload and `/tree` navigation, while preserving the isolation guarantees from ADR-0003 and the side-chat constraints that remain valid from ADR-0004.

## Goals

- Replace inline-only one-shot side-chat with a persistent overlay TUI.
- Expose four commands:
  - `/gremlins:chat`
  - `/gremlins:chat:new`
  - `/gremlins:tangent`
  - `/gremlins:tangent:new`
- Keep chat and tangent as independent threads.
- Persist completed exchanges through Pi custom session entries.
- Keep side-chat entries out of parent LLM context.
- Preserve zero-tool side-chat sessions and tangent's clean-context guarantee.

## User Stories

- As an operator, I can run `/gremlins:chat` to reopen my current contextual side-chat thread without losing prior turns.
- As an operator, I can run `/gremlins:chat:new` to discard the current chat thread and start over.
- As an operator exploring unrelated ideas, I can run `/gremlins:tangent` to reopen a clean side thread that never captured parent transcript context.
- As an operator, I can keep a side-chat overlay open, type multiple messages, close/reopen it, reload Pi, or navigate `/tree` without losing completed exchanges.
- As a maintainer, I can reason about side-chat persistence from explicit `pi.appendEntry` custom entries and tests.

## Scope

### In Scope

- Overlay TUI component for side-chat transcript, status, draft input, keyboard submit/close, and scroll handling.
- Persistent exchange entries with one reset marker per `:new` command.
- Restore logic from the active branch after `session_start` and `session_tree`.
- Context filter for side-chat custom data as defense-in-depth.
- Four-command side-chat surface.
- Optional inline argument compatibility: `/gremlins:chat <prompt>` and `/gremlins:tangent <prompt>` open the overlay and auto-submit the prompt.
- Tests for command dispatch, persistence restore, transcript reducer, and overlay input.
- README and changelog updates.

### Out of Scope

- Tool access inside side-chat sessions.
- Per-side-chat model or thinking overrides.
- Inject/summarize/handoff from side-chat into parent.
- Multiple simultaneous chat or tangent threads of the same mode.
- Restoring in-flight, uncompleted streaming turns after process shutdown.

## Acceptance Criteria

- [x] `/gremlins:chat` opens overlay and resumes chat thread or creates a new thread.
- [x] `/gremlins:chat:new` appends a chat reset marker, clears only chat state, and opens overlay.
- [x] `/gremlins:tangent` opens overlay and resumes tangent thread or creates a new thread.
- [x] `/gremlins:tangent:new` appends a tangent reset marker, clears only tangent state, and opens overlay.
- [x] Overlay uses Pi `ctx.ui.custom(..., { overlay: true })` with top-center, 78% width/max-height, margin, and non-capturing options.
- [x] Overlay renders mode label, transcript rows, status, draft input, submit/close controls, and scroll keys.
- [x] Completed exchanges persist through `pi.appendEntry("pi-gremlins:side-chat-thread", ...)`.
- [x] `:new` writes `pi-gremlins:side-chat-reset` and restore ignores older entries for that mode only.
- [x] Restore runs on session start and tree navigation from the current branch.
- [x] Context hook filters side-chat custom messages defensively.
- [x] Side-chat session config keeps `tools: []`.
- [x] Tangent never captures parent transcript.
- [x] Chat captures parent transcript once at thread origin.
- [x] Automated tests cover command surface, persistence restore, reducer folding, and overlay key handling.

## Technical Surface

- **Runtime:** `extensions/pi-gremlins/side-chat-command.ts`
- **Overlay:** `extensions/pi-gremlins/side-chat-overlay.ts`
- **Persistence:** `extensions/pi-gremlins/side-chat-persistence.ts`
- **Transcript reducer:** `extensions/pi-gremlins/side-chat-transcript-state.ts`
- **Related ADR:** ADR-0005

## Revision History

- 2026-04-30 — Created and completed with issue #49 implementation.
