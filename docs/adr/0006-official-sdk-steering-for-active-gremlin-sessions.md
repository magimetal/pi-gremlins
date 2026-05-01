# ADR-0006: Official SDK Steering for Active Gremlin Sessions

- **Status:** Accepted
- **Date:** 2026-04-30
- **Decision Maker:** magimetal
- **Related:** GitHub issue [#53](https://github.com/magimetal/pi-gremlins/issues/53), [PRD-0006](../prd/0006-active-gremlin-session-steering.md), [ADR-0002](0002-in-process-sdk-based-gremlin-runtime.md), [ADR-0003](0003-unified-agent-discovery-and-primary-agent-prompt-injection-in-pi-gremlins.md)
- **Supersedes:** ADR-0002 and ADR-0003 targeted-steering prohibition only. Legacy subprocess/RPC/viewer steering remains prohibited.

## Context

ADR-0002 moved gremlin execution from nested Pi subprocesses to isolated in-process SDK child `AgentSession`s and removed legacy `/gremlins:steer` with the old viewer/RPC surface. ADR-0003 preserved that prohibition while merging primary-agent controls into `pi-gremlins`.

Issue #53 changes the available technical option: Pi SDK now provides official child `AgentSession.steer(message)` support. The old steering ban protected the v1 rewrite from reintroducing fragile subprocess/RPC/viewer architecture; it was not a permanent product claim that active child SDK sessions can never be steered. The architecture now needs a narrow official-SDK steering path that keeps the v1 child-session runtime and isolation model intact.

The command must deliver steering to the target active child session after that child assistant turn finishes current tool calls and before the child makes its next LLM call. It must not wait for a later parent user turn and must not be implemented through parent-session message injection.

## Decision Drivers

- Correctness: steering must target the active child `AgentSession` that is already running the gremlin.
- SDK alignment: use the official `AgentSession.steer(message)` API instead of inventing transport or prompt-mutation behavior.
- Isolation: child sessions must remain isolated from parent history, parent system prompt, primary-agent markdown, extensions, skills, prompts, themes, and `AGENTS` loading.
- Runtime containment: active session references must be short-lived, cleaned up deterministically, and never persisted.
- Safety: stale, inactive, disposed, completed, failed, canceled, aborted, setup-failed, unknown, or ambiguous ids must fail closed.
- Scope preservation: no legacy subprocess/RPC steering, popup viewer, chain mode, package-agent discovery, scope toggles, or old schema paths return.
- Testability: parser, registry, lifecycle cleanup, negative legacy-path checks, and direct SDK steering call behavior must be covered by focused tests.

## Options Considered

### Option A: Keep steering unsupported

- Pros:
  - Preserves the narrowest v1 runtime surface.
  - Avoids active-session registry lifecycle risk.
  - Requires no new command UX or concurrency ambiguity policy.
- Cons:
  - Leaves official SDK capability unused.
  - Prevents operators from correcting active long-running gremlins.
  - Conflicts with issue #53's requested implementation-ready `/gremlins:steer` command.

### Option B: Reintroduce legacy subprocess/RPC/viewer steering

- Pros:
  - Resembles historical command name and some historical tests.
  - Could reuse old mental model if old code still existed.
- Cons:
  - Directly violates ADR-0002's reason for the v1 rewrite.
  - Reopens subprocess lifecycle, viewer state, and protocol complexity that the package intentionally removed.
  - Does not align with current in-process child SDK sessions.
  - Risks parent/child prompt isolation regressions.

### Option C: Register `/gremlins:steer` and call active child `AgentSession.steer(message)` through a short-lived registry

- Pros:
  - Uses official Pi SDK steering semantics.
  - Keeps current in-process child-session architecture.
  - Avoids parent `sendUserMessage`, `followUp`, prompt mutation, subprocess RPC, and popup/viewer UI.
  - Makes lifecycle and stale-reference behavior explicit and testable.
  - Allows safe ambiguity handling across concurrent batches.
- Cons:
  - Adds a new active-session registry and lifecycle cleanup responsibility.
  - Requires careful id resolution policy because existing displayed ids such as `g1` can repeat across concurrent tool calls.
  - Adds command UX and tests for a previously removed surface.

## Decision

Chosen: **Option C: Register `/gremlins:steer` and call active child `AgentSession.steer(message)` through a short-lived registry**.

Rationale: Official child-session steering lets `pi-gremlins` restore useful active gremlin redirection without restoring the legacy architecture that ADR-0002 removed. The command is allowed only as a thin SDK-backed path to the currently active child `AgentSession`; all old subprocess/RPC/viewer steering mechanisms remain rejected.

The implementation must follow these architectural constraints:

- Register the command through `pi.registerCommand("gremlins:steer", ...)`.
- Keep command handling in a focused module rather than expanding `index.ts` into a command monolith.
- Track active child SDK sessions in a focused registry module.
- Register a child session only while its gremlin can be steered.
- Deregister on normal completion, failure, cancellation, abort, setup failure, disposal, and extension/session shutdown.
- Resolve gremlin ids case-insensitively for `G1`/`g1` unless stricter behavior is intentionally documented and tested.
- Fail ambiguous ids safely, or expose a stable namespace such as `toolCallId` and test it.
- Invoke only the target child `AgentSession.steer(message)` on success.
- Do not use parent `pi.sendUserMessage`, `deliverAs: "steer"`, `followUp`, legacy subprocess/RPC channels, popup viewer state, or prompt-history injection.
- Preserve child-session factory isolation and do not load parent resources into child sessions.

## Consequences

- **Positive:** Operators gain a supported way to redirect active gremlins while they are still running.
- **Positive:** Steering uses official SDK semantics and remains inside the accepted ADR-0002 in-process architecture.
- **Positive:** Legacy steering paths stay prohibited, making regression tests clear: official child `AgentSession.steer` is allowed; parent/subprocess/viewer steering is not.
- **Negative:** Runtime now needs an active session registry and cleanup paths across runner, scheduler, tool execution, and extension shutdown.
- **Negative:** Gremlin ids that repeat across concurrent batches require explicit ambiguity handling or namespacing.
- **Follow-on constraints:** Future changes to steering id format, registry persistence, or cross-session steering require a new PRD/ADR review because they affect user-visible command semantics and runtime boundaries.

## Implementation Impact

- **apps/api:** N/A. Standalone Pi package, no `apps/api` workspace.
- **apps/web:** N/A. No web frontend package.
- **packages/shared:** N/A. No shared package contract change.
- **packages/utils:** N/A. No standalone utils package in this repository.
- **Migration/ops:**
  - No persistent config or data migration.
  - Runtime gains an in-memory active child session registry only.
  - README must document command syntax, active-lifetime limits, timing, ambiguity behavior, and legacy-path exclusions.
  - CHANGELOG must cite PRD-0006 and ADR-0006 when implementation lands.
  - Existing tests that asserted no `gremlins:steer` command must be updated to reject only legacy steering mechanisms.

## Verification

- **Automated:**
  - Command registration test confirms `gremlins:steer` is registered and no legacy viewer/RPC steering command path is reintroduced.
  - Parser tests cover missing id, missing message, multi-word message preservation, and documented `G1`/`g1` behavior.
  - Registry tests cover register, resolve, ambiguity handling or namespace handling, completion cleanup, cancellation cleanup, abort cleanup, setup-failure cleanup, disposal cleanup, stale id rejection, and extension/session shutdown cleanup.
  - Handler test verifies successful steering invokes child `AgentSession.steer(message)` exactly once.
  - Negative tests verify no parent `pi.sendUserMessage`, `deliverAs: "steer"`, `followUp`, subprocess/RPC steering, popup viewer, or prompt-history path is used.
  - Timing/queueing test uses an SDK fake or mocked child `AgentSession.steer` to prove steering is queued against the current child session and does not require a later parent turn.
  - Isolation regression tests confirm child session creation still excludes parent history/system/primary-agent markdown/extensions/skills/prompts/themes/`AGENTS` content.
  - Full repository verification after implementation: `npm run typecheck`, `npm test`, and `npm run check`.
- **Manual:**
  - Start a long-running gremlin, run `/gremlins:steer G1 <message>`, and verify a queued confirmation appears without popup/viewer UI.
  - Verify steering affects the active child session at the next SDK steering boundary.
  - Try unknown, completed, canceled, failed, stale, and ambiguous ids and confirm they fail with clear notifications.

## Notes

This ADR supersedes only the targeted-steering prohibition in ADR-0002 and ADR-0003 for the official Pi SDK child-session steering path. It does not supersede the bans on nested Pi subprocess execution, popup viewers, `/gremlins:view`, chain mode, package-agent discovery, scope toggles, parent prompt/history leakage, or old schema paths.

## Status History

- 2026-04-30: Accepted for issue #53; permits official child `AgentSession.steer(message)` for active gremlin sessions while preserving legacy steering prohibitions.
- 2026-04-30: Verified against implementation commit `f1e77d6b5eb1e82372c916cebb92a21e9dfd5b18` and PR [#55](https://github.com/magimetal/pi-gremlins/pull/55); decision remains aligned and status remains Accepted.
