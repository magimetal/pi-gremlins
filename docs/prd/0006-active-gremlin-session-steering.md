# PRD-0006: Active Gremlin Session Steering

- **Status:** Completed
- **Date:** 2026-04-30
- **Author:** magimetal
- **Related:** GitHub issue [#53](https://github.com/magimetal/pi-gremlins/issues/53), [ADR-0006](../adr/0006-official-sdk-steering-for-active-gremlin-sessions.md), [PRD-0002](0002-pi-gremlins-v1-sdk-rewrite.md), [PRD-0003](0003-primary-agent-selection-and-pi-mohawk-deprecation.md)
- **Supersedes:** PRD-0002 and PRD-0003 targeted-steering non-goal only. Legacy subprocess/RPC/viewer steering remains out of scope.

## Problem Statement

Pi SDK now exposes first-class child `AgentSession.steer(message)` support. `pi-gremlins` already runs gremlins as isolated in-process SDK child sessions, but it has no supported way for an operator to steer an active gremlin while that child session is still running.

Current governance intentionally removed targeted steering during the v1 SDK rewrite because the old implementation was tied to subprocess/RPC and popup-viewer machinery. Issue #53 asks to add steering back through the official SDK API, not through legacy mechanisms. Product scope must therefore reopen steering for active child SDK sessions while preserving the v1 bans on subprocess steering, viewer UI, `followUp`, parent-message injection, chain mode, and prompt isolation leaks.

## User Stories

- As an operator, I want `/gremlins:steer <G-id> <message>` so that I can redirect an active gremlin without waiting for a later parent turn.
- As an operator running parallel gremlins, I want invalid, stale, completed, or ambiguous ids rejected clearly so that steering goes only to the intended child session.
- As a maintainer, I want steering implemented through official child `AgentSession.steer(message)` so that no legacy subprocess/RPC/viewer steering path returns.
- As a cautious user, I want gremlin prompt isolation preserved so that steering does not leak parent history, primary-agent markdown, extensions, skills, prompts, themes, or `AGENTS` content into child sessions.

## Scope

### In Scope

- Register `/gremlins:steer <G-id> <message>` through `pi.registerCommand("gremlins:steer", ...)`.
- Parse the first argument as the gremlin id and the remaining text as the steering message.
- Preserve multi-word steering messages exactly after the id.
- Show clear notifications for missing id, missing message, unknown id, inactive id, stale id, disposed session, completed gremlin, canceled gremlin, failed gremlin, aborted gremlin, setup-failed gremlin, or ambiguous id.
- Accept `G1` and `g1` case-insensitively unless implementation explicitly documents and tests a stricter casing policy.
- Track active child SDK `AgentSession`s only for the lifetime in which a gremlin can be steered.
- Deregister sessions promptly on normal completion, failure, cancellation, abort, setup failure, disposal, and extension/session shutdown.
- Handle concurrent-batch `g1` ambiguity safely by failing ambiguous references with a clear notification, unless implementation chooses and documents a stable namespace such as `toolCallId`.
- Invoke the target child session's `AgentSession.steer(message)` directly on successful command handling.
- Rely on official SDK steering timing: queued after the current child assistant turn finishes current tool calls and before the next child LLM call.
- Update tests and docs that previously asserted no `/gremlins:steer` support so they now describe official SDK steering and still reject legacy steering mechanisms.

### Out of Scope

- Reintroducing legacy subprocess/RPC steering.
- Reintroducing popup viewer UI, `/gremlins:view`, viewer snapshots, or steering controls inside a viewer surface.
- Steering through parent `pi.sendUserMessage`, `deliverAs: "steer"`, `followUp`, parent transcript mutation, or a later parent user turn.
- Chain mode, package-agent discovery, scope toggles, or old multi-mode tool schemas.
- Cross-session steering, steering completed gremlins, steering archived gremlin results, or retaining stale sessions after a run ends.
- Persisting steering messages or active session registry state beyond the active runtime lifetime.
- Relaxing child isolation or loading parent extensions, prompts, skills, themes, `AGENTS` files, parent system prompt snapshots, primary-agent markdown, or parent conversation history into child sessions.
- Adding decorative popup/overlay UX for steering confirmation.

## Acceptance Criteria

- [x] `/gremlins:steer <G-id> <message>` is registered through `pi.registerCommand("gremlins:steer", ...)`.
- [x] The command parser treats the first argument as the gremlin id and the remaining text as the steering message.
- [x] Missing id and missing message produce clear notifications and do not call steering.
- [x] Successful command handling calls the target child SDK `AgentSession.steer(message)` exactly once with the parsed message.
- [x] The implementation does not use parent `pi.sendUserMessage`, `deliverAs: "steer"`, `followUp`, subprocess/RPC steering, or viewer/popup UI.
- [x] Active child SDK sessions are registered as soon as they can be steered and are keyed in a way that can safely resolve or reject user ids.
- [x] Registry entries exist only during the relevant active `runSingleGremlin` lifetime and are removed on completion, failure, cancellation, abort, setup failure, disposal, and extension/session shutdown.
- [x] Unknown, completed, canceled, disposed, failed, aborted, setup-failed, and stale gremlin ids are rejected safely.
- [x] `G1`/`g1` behavior is documented and covered by tests.
- [x] Concurrent-batch id ambiguity is handled safely by failing ambiguous references with a clear notification or by documenting/testing a stable namespace.
- [x] Steering observes official Pi SDK timing and does not wait for the parent user's next turn or gremlin completion.
- [x] Child isolation remains intact: no parent history/system/primary-agent markdown/extensions/skills/prompts/themes/`AGENTS` leakage is introduced.
- [x] Existing tests/docs that currently encode "no `/gremlins:steer`" are updated to permit official SDK steering only and still ban legacy steering mechanisms.
- [x] User-facing docs explain syntax, lifecycle limits, ambiguity behavior, expected timing, and the distinction from removed legacy steering.
- [x] CHANGELOG entry for implementation references PRD-0006 and ADR-0006.

## Technical Surface

- **Extension entry:** `extensions/pi-gremlins/index.ts` registers `gremlins:steer` beside the existing tool and primary-agent controls.
- **Command handler:** new focused module such as `extensions/pi-gremlins/gremlin-steer-command.ts` for parsing, validation, notifications, and direct `AgentSession.steer(message)` invocation.
- **Active session registry:** new focused module such as `extensions/pi-gremlins/gremlin-session-registry.ts` to register active child sessions, resolve ids, reject stale/ambiguous references, and clean up lifecycle state.
- **Runner/scheduler/tool execution:** `extensions/pi-gremlins/gremlin-runner.ts`, `gremlin-scheduler.ts`, and `gremlin-tool-execution.ts` integrate registry registration and cleanup without changing the public tool schema.
- **Session factory:** `extensions/pi-gremlins/gremlin-session-factory.ts` remains responsible for isolated child session construction; steering must not weaken its resource-loader boundaries.
- **Docs:** README and CHANGELOG need implementation-phase updates; governance links are [ADR-0006](../adr/0006-official-sdk-steering-for-active-gremlin-sessions.md) and this PRD.
- **Related ADRs:** [ADR-0006](../adr/0006-official-sdk-steering-for-active-gremlin-sessions.md).

## UX Notes

- Command syntax is terse: `/gremlins:steer <G-id> <message>`.
- Confirmation should be inline/notification-based, not popup-based.
- Error copy should distinguish malformed usage from inactive/stale/ambiguous gremlin ids.
- Steering should be described as queued by the SDK for the target child session's next LLM boundary, not as an immediate tool interruption.
- Ambiguity across concurrent batches should fail safe unless a namespaced id is made visible to users.
- The visible gremlin id format should stay aligned with existing inline rendering (`g1`, `g2`, ...), with casing behavior explicitly documented.

## Resolved Questions

- Concurrent batches use fail-on-ambiguous `g1` behavior for the first implementation; no user-visible `toolCallId:g1` namespace was added.
- Command success remains concise and id-based; no additional display-name/agent-name requirement was added.

## Revision History

- 2026-04-30: Active PRD created for issue #53; supersedes only the prior targeted-steering non-goal for official SDK child-session steering.
- 2026-04-30: Marked Completed after implementation commit `f1e77d6b5eb1e82372c916cebb92a21e9dfd5b18`, PR [#55](https://github.com/magimetal/pi-gremlins/pull/55), and passing execution review.
