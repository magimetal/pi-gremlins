# ADR-0005: Persistent Overlay Side-Chat

- **Status:** Accepted
- **Date:** 2026-04-30
- **Decision Maker:** magimetal
- **Related:** PRD-0005, PRD-0004, ADR-0004, ADR-0003, GitHub issue #49
- **Supersedes:** ADR-0004 decisions D1 (inline-only/no overlay) and D2 (no `pi.appendEntry` side-chat persistence).

## Context

ADR-0004 deliberately absorbed side-chat from pi-gizmo in the smallest safe shape: fresh zero-tool child sessions, inline result messages, and no persistence. That was appropriate for issue #47 because it eliminated the legacy nested Pi CLI runtime and avoided restoring pi-gizmo's broad command surface.

Issue #49 provides direct user feedback that the product need is a persistent multi-turn side conversation. Pi now exposes a canonical custom overlay API (`ctx.ui.custom` with `overlay: true`) and custom entries (`pi.appendEntry`) are the standard extension persistence primitive. We can therefore restore the desired UX without reviving the rejected pi-gizmo runtime.

## Decision

Implement side-chat as two persistent overlay-backed threads: one `chat` thread and one `tangent` thread.

- `/gremlins:chat` opens the overlay and resumes chat if present, otherwise starts chat.
- `/gremlins:chat:new` writes a chat reset marker and opens a fresh chat thread.
- `/gremlins:tangent` opens the overlay and resumes tangent if present, otherwise starts tangent.
- `/gremlins:tangent:new` writes a tangent reset marker and opens a fresh tangent thread.
- Completed exchanges are persisted as `pi-gremlins:side-chat-thread` custom entries.
- Resets are persisted as `pi-gremlins:side-chat-reset` custom entries.
- Restore scans the active branch and keeps only thread entries after the latest per-mode reset.
- A context hook filters side-chat custom data defensively from parent LLM context.
- Chat captures parent transcript once at thread origin; resumes do not re-capture later parent turns.
- Tangent never captures parent transcript.
- Side-chat child sessions keep `tools: []` and inherit parent model/thinking fallback without exposing per-thread overrides.

## Preserved Decisions

ADR-0004 decisions still in force:

- **D3:** tangent never captures parent transcript context.
- **D4:** side-chat sessions have zero tools.
- **D8:** no per-side-chat model/thinking overrides.

ADR-0003 isolation remains binding: side-chat child sessions must not inherit parent extensions, skills, prompts, themes, AGENTS files, primary-agent markdown, or unapproved parent prompt material.

## Superseded Decisions

- **ADR-0004 D1:** Inline-only/no overlay is superseded. Side-chat now uses Pi's canonical custom overlay API.
- **ADR-0004 D2:** No side-chat `pi.appendEntry` persistence is superseded. Side-chat uses custom entries for completed exchanges and reset markers.

## Consequences

### Positive

- Side-chat supports the requested multi-turn workflow.
- Threads survive reloads and tree navigation on the active branch.
- The overlay separates side conversation from parent transcript rendering.
- Persistence uses Pi-native custom entries instead of a separate store.
- Reset markers make thread discard explicit and auditable.

### Negative / Tradeoffs

- Runtime state is more complex than PRD-0004's one-shot command path.
- In-flight streaming turns are not restored after shutdown; only completed exchanges persist.
- Optional inline argument compatibility is retained, so command parsing is not purely argument-less.

## Alternatives Considered

### Keep inline one-shot side-chat

Rejected. It does not satisfy issue #49's multi-turn persistence requirement.

### Reintroduce pi-gizmo wholesale

Rejected. It would revive the nested runtime and broad command surface ADR-0002/ADR-0004 intentionally retired.

### Persist complete child session state

Rejected for now. Persisting completed exchanges is enough to reconstruct user-visible thread history and avoid coupling to SDK-private session internals.

### Store thread state outside Pi session entries

Rejected. Custom entries follow Pi extension conventions and preserve per-branch behavior naturally.

## Validation

- `npm run typecheck`
- `npm test`
- `npm run check`

## Status History

- 2026-04-30 — Accepted with issue #49 implementation.
