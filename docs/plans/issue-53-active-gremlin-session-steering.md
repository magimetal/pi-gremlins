# Issue 53 Plan: Active Gremlin Session Steering

## Objective

Implement `/gremlins:steer <G-id> <message>` for active in-process gremlin child sessions, aligned with [PRD-0006](../prd/0006-active-gremlin-session-steering.md) and [ADR-0006](../adr/0006-official-sdk-steering-for-active-gremlin-sessions.md).

## Key Decisions To Preserve

- Use `pi.registerCommand("gremlins:steer", ...)`.
- On success, call the target child SDK `AgentSession.steer(message)` directly and exactly once.
- Await `session.steer(message)` and catch rejection; steering rejection must produce a failure notification and must not also show success or fall back to any legacy path.
- Maintain an in-memory active child-session registry scoped to the extension runtime.
- Resolve `G1`/`g1` case-insensitively.
- Fail closed for unknown, inactive, stale, disposed, terminal, or ambiguous ids.
- For concurrent batches where more than one active `g1` exists, reject `g1` as ambiguous rather than guessing.
- Use an opaque registration handle or composite key for exact unregister so removing one duplicate active `g1` never removes or corrupts another active `g1`.
- Treat the command argument contract as `args: string` unless tests prove optional array forms are actually emitted by the harness/SDK; do not add untested parser surface.
- Do not add parent `pi.sendUserMessage`, `deliverAs: "steer"`, `followUp`, subprocess/RPC steering, popup/viewer UI, prompt-history injection, or persistence.
- Preserve explicit user authorization from the `git-issue-fix` workflow to commit, push, and open/update the PR, but perform those git/GitHub steps only after required verification passes and no blockers remain.

## Implementation Tasks

### 1. Add focused active-session registry

**What**
- Create `extensions/pi-gremlins/gremlin-session-registry.ts`.
- Define a narrow steerable-session type containing `steer(message): Promise<unknown> | unknown` plus optional disposal/status metadata only if required for tests.
- Store active entries with at least: normalized display id (`g1`), original display id, `toolCallId`/run key, agent name, session reference, and an internal opaque registration handle or composite key.
- Make `registerActiveGremlinSession(...)` return the opaque registration handle/key. Require `unregisterActiveGremlinSession(handle)` to remove exactly that entry, not every entry with the same display id.
- Provide operations such as `registerActiveGremlinSession`, `unregisterActiveGremlinSession`, `resolveActiveGremlinSession`, and `clearActiveGremlinSessions`.
- Make `resolveActiveGremlinSession("G1")` case-insensitive and return discriminated results for `missing`, `ambiguous`, and `active`.
- Treat removed entries as non-steerable; error copy can say no active gremlin was found and mention completed/canceled/failed/stale/disposed possibilities.

**References**
- `extensions/pi-gremlins/gremlin-session-registry.ts` (new)
- `docs/prd/0006-active-gremlin-session-steering.md`
- `docs/adr/0006-official-sdk-steering-for-active-gremlin-sessions.md`

**Acceptance criteria**
- Active entries can be registered, resolved, unregistered by exact handle/key, and cleared.
- `G1` and `g1` resolve to the same active session when unambiguous.
- Duplicate active display ids from different run keys resolve as `ambiguous`.
- Duplicate active `g1` entries stay independent: unregistering the first handle leaves the second `g1` registered and resolvable; unregistering the second handle then makes `g1` missing.
- Unknown or removed ids do not expose any session and fail closed.

**Guardrails**
- Do not persist registry state.
- Do not key unregister only by display id.
- Do not expose parent transcript, prompt, resource-loader, or session-manager data through registry entries.
- Do not add stale-session resurrection or cross-session steering.

**Verification**
- Add `extensions/pi-gremlins/gremlin-session-registry.test.js` covering registration, case-insensitive lookup, ambiguity, exact unregister by opaque handle/key, duplicate active `g1` ambiguity followed by exact unregister leaving the remaining `g1` resolvable, clear, and missing/stale rejection.
- Run: `bun test extensions/pi-gremlins/gremlin-session-registry.test.js`.

### 2. Add slash-command parser and handler

**What**
- Create `extensions/pi-gremlins/gremlin-steer-command.ts`.
- Lock the command argument contract with tests before wiring behavior: observed harness registration stores command objects from `pi.registerCommand`, and the implementation must treat command invocation as receiving `args: string` unless tests demonstrate another current shape. Optional string-array support may be added only if a test proves the SDK/harness emits arrays.
- Parse the first non-empty token in the raw `args: string` as the gremlin id.
- Preserve the steering message as the remaining raw substring after the id, including internal spacing and punctuation. Normalize only leading separator whitespace between id and message and reject an all-whitespace remainder as missing message.
- Return clear notifications for missing id, missing message, unknown/inactive/stale id, and ambiguous id.
- For an active resolved entry, call `await entry.session.steer(message)` directly once and show a concise success notification only after it resolves.
- If `session.steer(message)` rejects or throws, catch it, show a failure notification, and do not show success, retry through fallback APIs, or mutate registry state except through normal lifecycle cleanup.
- Keep all command UX notification-based; no popup, overlay, viewer, or transcript mutation.

**References**
- `extensions/pi-gremlins/gremlin-steer-command.ts` (new)
- `extensions/pi-gremlins/side-chat-command.ts` for local command-registration and notification style only
- `extensions/pi-gremlins/v1-contract-harness.js` for command test harness support and observed command registration behavior

**Acceptance criteria**
- Handler tests lock `args: string` as the supported invocation shape; any optional array behavior is absent unless test-proven first.
- Missing id and missing message notify and do not call `steer`.
- Multi-word messages preserve the exact text after the id except for normalization of the separator whitespace between id and message.
- `G1`/`g1` behavior is tested and documented.
- Successful command handling awaits the target child session's `steer(message)` exactly once and only then notifies success.
- Rejected `steer(message)` notifies failure, does not notify success, and does not call parent/fallback steering APIs.
- Ambiguous ids notify and do not call any session.

**Guardrails**
- Do not call `pi.sendUserMessage`, `pi.sendMessage`, `followUp`, or any parent-session message injection API from the steer command. Existing unrelated harness message collection is not a steering mechanism.
- Do not implement `deliverAs: "steer"` or any synthetic user turn.
- Do not add `/gremlins:view` or viewer steering controls.
- Do not broaden parser support beyond the tested command argument contract.

**Verification**
- Add `extensions/pi-gremlins/gremlin-steer-command.test.js` for parser and handler behavior.
- Include tests for missing id/message, exact multi-word message preservation/whitespace normalization, case-insensitive id, ambiguity, successful awaited `steer`, and rejected `steer` failure notification with no success/fallback.
- Run: `bun test extensions/pi-gremlins/gremlin-steer-command.test.js`.

### 3. Register the command and wire registry lifecycle through execution

**What**
- In `extensions/pi-gremlins/index.ts`, instantiate one active-session registry inside `createPiGremlinsExtension`.
- Register `gremlins:steer` beside existing commands via `pi.registerCommand("gremlins:steer", ...)`.
- Pass the registry and tool call id from `tool.execute(_toolCallId, ...)` into `executePiGremlinsTool`, then into `runSingleGremlin` through the scheduler path.
- Clear the registry on `session_shutdown`.
- Register each child session after `createSession` succeeds and before `session.prompt(...)` starts; store the returned opaque handle/key in the local run scope.
- Unregister by that exact handle/key in `finally` before/around `session.dispose()` so completion, failure, cancellation, abort, and disposal all remove steerability without affecting duplicate ids from other active runs.
- Keep validation/discovery/setup failures unregistered so setup-failed or unknown gremlins are non-steerable.

**References**
- `extensions/pi-gremlins/index.ts`
- `extensions/pi-gremlins/gremlin-tool-execution.ts`
- `extensions/pi-gremlins/gremlin-scheduler.ts`
- `extensions/pi-gremlins/gremlin-runner.ts`
- `extensions/pi-gremlins/gremlin-session-factory.ts`

**Acceptance criteria**
- Command count and registration tests expect `gremlins:steer` and still reject `gremlins:view`.
- Active child sessions become steerable only during their `runSingleGremlin` lifetime.
- Lifecycle test proves: when `createSession` succeeds and later `session.prompt(...)` rejects, the session was registered before prompt and then unregistered/disposed in cleanup.
- Registry cleanup happens on normal completion, thrown failure, parent abort/child cancellation, setup failure path, disposal, and `session_shutdown`.
- Concurrent runs using duplicate display ids fail ambiguous while both are active, and after one exact handle is unregistered the remaining entry becomes resolvable.

**Guardrails**
- Do not change the public `pi-gremlins` tool schema.
- Do not weaken `gremlin-session-factory.ts` isolation resources.
- Do not change gremlin rendering ids except as needed to keep `g1`, `g2`, ... documented.
- Avoid broad refactors; pass minimal dependencies through existing option objects.

**Verification**
- Update `extensions/pi-gremlins/index.execute.test.js` to expect `gremlins:steer` registration and no `gremlins:view`.
- Update/add runner execution tests proving registration and cleanup across completion, prompt rejection after registration, failure, abort/cancel, and dispose.
- Add an integration-style test using the harness: start a fake long-running session, invoke the registered command with `args: "G1 keep investigating auth flow"`, assert fake `steer` receives `keep investigating auth flow` without waiting for a parent turn, then finish and assert later steering is rejected.
- Run: `bun test extensions/pi-gremlins/index.execute.test.js extensions/pi-gremlins/gremlin-runner.test.js`.

### 4. Add negative legacy-path and isolation regression coverage

**What**
- Update tests that currently encode no `/gremlins:steer` support so they allow official SDK steering only.
- Add focused negative assertions that implementation does not use parent `sendUserMessage`, `deliverAs: "steer"`, `followUp`, subprocess/RPC channels, popup/viewer UI, or prompt-history injection.
- Prefer behavior-level mocks/assertions over brittle source-code string tests where possible.
- For source/diff inspection of forbidden mechanisms, expect known documentation and test hits; manually verify that any hits are bans, assertions, docs, or unrelated pre-existing APIs rather than implementation of a forbidden steering path.
- Preserve existing isolation tests around child resources and parent prompt/history exclusion.

**References**
- `extensions/pi-gremlins/index.execute.test.js`
- `extensions/pi-gremlins/gremlin-rendering.test.js`
- `extensions/pi-gremlins/index.render.test.js`
- `extensions/pi-gremlins/gremlin-session-factory.test.js`
- `extensions/pi-gremlins/v1-contract-harness.js`
- `README.md`
- `CHANGELOG.md`

**Acceptance criteria**
- Tests no longer assert `commands.has("gremlins:steer")` is false.
- Tests still assert no `/gremlins:view`, popup viewer, subprocess steering, parent-message steering, or prompt leakage returns.
- Any `grep` hits for `sendUserMessage`, `deliverAs`, `followUp`, `gremlins:view`, or legacy steering terms are manually classified as expected docs/tests/bans or unrelated non-steering references.
- Child session creation remains isolated from parent system prompt snapshots, primary-agent markdown, extensions, skills, prompts, themes, and `AGENTS` files.

**Guardrails**
- Do not remove legacy bans to make tests pass.
- Do not add brittle source-code string tests where behavior-level mocks can prove the same constraint.
- Do not treat grep hits in documentation or negative tests as automatic failures; inspect them and fail only on forbidden implementation paths.

**Verification**
- Run: `bun test extensions/pi-gremlins/index.execute.test.js extensions/pi-gremlins/gremlin-rendering.test.js extensions/pi-gremlins/index.render.test.js extensions/pi-gremlins/gremlin-session-factory.test.js`.
- Run for manual classification, not automatic pass/fail: `grep -R "sendUserMessage\|deliverAs.*steer\|followUp\|gremlins:view" -n extensions/pi-gremlins README.md CHANGELOG.md docs/prd/0006-active-gremlin-session-steering.md docs/adr/0006-official-sdk-steering-for-active-gremlin-sessions.md`.

### 5. Update user-facing docs and changelog

**What**
- Add README usage documentation for `/gremlins:steer <G-id> <message>`.
- Document lifecycle limits: only active gremlins can be steered; completed/canceled/failed/stale/disposed/setup-failed/unknown ids are rejected.
- Document timing: SDK queues steering for the target child session after current child tool calls complete and before the next child LLM call.
- Document `G1`/`g1` case-insensitive behavior and duplicate-id ambiguity rejection across concurrent active batches.
- Document whitespace behavior: the id is parsed from the first non-empty token; the message is the remaining text after the id with separator whitespace normalized, while internal multi-word spacing/punctuation is preserved as sent to `AgentSession.steer(message)`.
- Document that this is official child `AgentSession.steer(message)` support, not restored legacy subprocess/RPC/viewer steering.
- Add an Unreleased CHANGELOG entry referencing PRD-0006, ADR-0006, and issue #53.

**References**
- `README.md`
- `CHANGELOG.md`
- `docs/prd/0006-active-gremlin-session-steering.md`
- `docs/adr/0006-official-sdk-steering-for-active-gremlin-sessions.md`

**Acceptance criteria**
- README contains syntax, lifecycle limits, ambiguity behavior, expected timing, whitespace/multi-word message behavior, and legacy-path distinction.
- CHANGELOG cites PRD-0006, ADR-0006, and issue #53.

**Guardrails**
- Do not document future namespace formats unless implemented and tested.
- Do not imply archived/completed gremlins can be steered.
- Do not imply steering interrupts currently running child tool calls immediately.

**Verification**
- Manual readback of README and CHANGELOG diffs.

### 6. Final verification, authorized commit/push, and PR

**What**
- Run focused tests first, then full repository checks.
- Inspect the diff for forbidden mechanisms and accidental scope expansion.
- Commit only implementation, tests, README, and CHANGELOG changes for issue #53 after verification passes.
- Push the issue branch and create or update the PR after the commit only if verification passes and no blockers remain.
- Prepare PR notes linking issue #53, PRD-0006, and ADR-0006.

**References**
- `package.json`
- full repository diff
- GitHub issue `#53`
- `docs/prd/0006-active-gremlin-session-steering.md`
- `docs/adr/0006-official-sdk-steering-for-active-gremlin-sessions.md`

**Acceptance criteria**
- `npm run typecheck` passes.
- `npm test` passes.
- `npm run check` passes.
- Diff contains no forbidden parent-message, `deliverAs`, `followUp`, subprocess/RPC, popup/viewer, or prompt-history steering path.
- Any forbidden-mechanism grep hits are manually classified as expected docs/tests/bans or unrelated non-steering references.
- Commit is made only after verification passes and includes no unrelated files.
- Push and PR creation/update are performed only after the verified commit and only if no blockers remain, using the explicit `git-issue-fix` authorization.
- PR summary explains command syntax, registry lifecycle, exact unregister/ambiguity policy, rejection handling, and verification results.

**Guardrails**
- Do not commit, push, or open/update the PR if focused tests, full checks, or manual forbidden-path inspection have unresolved failures.
- Do not commit unrelated files.
- Do not include generated artifacts unless already tracked and intentionally updated.
- Do not claim manual runtime verification unless actually performed in Pi.

**Verification**
- Run:
  - `npm run typecheck`
  - `npm test`
  - `npm run check`
  - `grep -R "sendUserMessage\|deliverAs.*steer\|followUp\|gremlins:view" -n extensions/pi-gremlins README.md CHANGELOG.md docs/prd/0006-active-gremlin-session-steering.md docs/adr/0006-official-sdk-steering-for-active-gremlin-sessions.md`
- Manually inspect grep output and full diff; expected hits in docs/tests/bans do not fail verification, but forbidden implementation paths do.
- Manual PR checklist: issue linked, PRD/ADR linked, tests listed, risks stated, push/PR performed only after passing verification.

## Risks / Unknowns

- **Observed:** Existing display ids are per-batch (`g1`, `g2`, ...), so concurrent batches can produce duplicate active ids. First implementation should reject ambiguous ids and use exact opaque-handle/composite-key unregister.
- **Observed:** Existing tests explicitly assert no `gremlins:steer`; they must be narrowed to ban legacy steering only.
- **Observed:** The local command harness stores registered command objects via `registerCommand(name, command)`; plan tests must lock the command invocation `args: string` contract before implementation behavior depends on it.
- **Inferred:** Pi SDK may expose additional command argument shapes in future, but optional array parsing should not be added unless current tests demonstrate it.
- **Unknown:** Whether SDK `AgentSession.steer` rejects after a child session internally starts disposing. Handler must catch errors, notify failure, and not show success or use fallback steering.

## Recommended Verification Sequence

1. `bun test extensions/pi-gremlins/gremlin-session-registry.test.js`
2. `bun test extensions/pi-gremlins/gremlin-steer-command.test.js`
3. `bun test extensions/pi-gremlins/index.execute.test.js extensions/pi-gremlins/gremlin-runner.test.js`
4. `bun test extensions/pi-gremlins/gremlin-rendering.test.js extensions/pi-gremlins/index.render.test.js extensions/pi-gremlins/gremlin-session-factory.test.js`
5. `npm run typecheck`
6. `npm test`
7. `npm run check`
8. Manual forbidden-mechanism grep/diff classification.
9. If and only if all verification passes with no blockers: commit, push, and create/update the PR under the user's explicit `git-issue-fix` authorization.

## Self-Review Checklist

- [x] Plan references PRD-0006 and ADR-0006.
- [x] Plan keeps implementation inside `extensions/pi-gremlins/`, README, and CHANGELOG.
- [x] Plan includes parser, registry, command registration, lifecycle cleanup, tests, docs, changelog, verification, commit, push, and PR steps.
- [x] Plan preserves all explicit forbidden paths.
- [x] Plan includes opaque handle/composite key exact unregister and duplicate `g1` ambiguity/unregister tests.
- [x] Plan requires awaiting/catching `session.steer(message)` rejection with failure notification and no success/fallback.
- [x] Plan locks the command `args: string` contract unless optional arrays are test-proven.
- [x] Plan includes createSession-success/prompt-reject lifecycle cleanup coverage.
- [x] Plan treats forbidden-mechanism grep as manual inspection with expected docs/test hits.
- [x] Plan clarifies whitespace preservation/normalization for multi-word messages.
- [x] Plan avoids speculative namespace work and chooses fail-on-ambiguous for duplicate ids.
- [x] Plan preserves explicit `git-issue-fix` commit/push/PR authorization while making git/GitHub steps conditional on passing verification and no blockers.
