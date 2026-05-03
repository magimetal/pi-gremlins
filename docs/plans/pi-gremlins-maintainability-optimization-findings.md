# Pi Gremlins Maintainability + Optimization Findings Implementation Plan

## Objective
Address the prior audit findings in `extensions/pi-gremlins` with one scope-controlled implementation pass: add bounded concurrency where fan-out is currently unbounded, bound expanded render output, remove small duplication, and fix the side-chat pending-question overlap risk. Preserve public command/tool schema and existing user-visible behavior except the explicit optimizations: bounded concurrency and bounded expanded output.

## Key Assumptions
- Public tool schema remains unchanged: do not add user-facing gremlin batch options or change the current 1..10 request bounds.
- Internal default concurrency limits are acceptable if exported only for tests or kept module-local.
- Existing runtime behavior should remain stable for normal small batches; output/result order must remain request order even if execution is scheduled in bounded waves.
- No broad rewrite of `gremlin-runner.ts` or `side-chat-command.ts`; only extract helpers/state required to resolve the approved findings.

## Recommended Implementation Order
1. For each behavior-changing task below, write/update the targeted test first, run that targeted test, and confirm the expected failure or contract mismatch before changing runtime code.
2. Add a small bounded async mapper utility and apply it to scheduler/discovery fan-out.
3. Remove duplicate text/cache helpers with tiny shared utilities.
4. Fix side-chat pending-question overlap with a queue-like state shape and tests.
5. Bound expanded render output and add tests.
6. Inspect public-facing gremlin tool wording after scheduler changes.
7. Run full verification.

## Tasks

### Task 1 — Add bounded async mapping for gremlin batch scheduling
**What**
- Introduce a small reusable bounded-concurrency helper, preferably in `extensions/pi-gremlins/gremlin-cache-utils.ts` only if naming stays generic enough; otherwise add `extensions/pi-gremlins/gremlin-async-utils.ts`.
- Apply it in `extensions/pi-gremlins/gremlin-scheduler.ts` so `runGremlinBatch` starts no more than a small module constant at once, e.g. `DEFAULT_GREMLIN_BATCH_CONCURRENCY = 4`.
- Preserve result ordering by original index and preserve current abort behavior: parent abort must abort running child controllers and mark queued/not-yet-started gremlins canceled without starting new work after abort.

**References**
- `extensions/pi-gremlins/gremlin-scheduler.ts`
- `extensions/pi-gremlins/gremlin-scheduler.test.js`
- Optional helper file: `extensions/pi-gremlins/gremlin-async-utils.ts`

**Acceptance criteria**
- Targeted scheduler test is written/updated first and fails before implementation for the expected bounded-concurrency or abort contract mismatch.
- With more gremlins than the internal limit, maximum simultaneous `runGremlin` calls never exceeds the limit.
- `GremlinBatchResult.results` remains in original request order.
- `mode` remains `"single"` for one gremlin and `"parallel"` for multiple gremlins.
- Parent abort resolves with final `results.length === gremlins.length`.
- Parent abort returns exactly one terminal result per requested gremlin, in original request order.
- Parent abort publishes canceled state for queued gremlins.
- Parent abort does not pass queued gremlins to `runGremlin` after abort.
- Parent abort still aborts running child controllers and resolves after running cleanup completes.

**Guardrails**
- Do not change public schema in `gremlin-schema.ts`.
- Do not add a new user-configurable option unless the implementation is explicitly re-scoped.
- Do not switch to fail-fast scheduling; sibling failures must not prevent already-eligible siblings from settling.

**Verification**
- Update the existing scheduler test currently named around “starts all requested gremlins in parallel immediately” to assert bounded parallelism instead.
- Add/adjust scheduler tests for order preservation and abort with queued work.
- Before runtime edits, run the targeted scheduler test and record the expected failure/contract mismatch.
- After the minimal scheduler fix, rerun the same targeted test and confirm it passes.
- Run: `npm test -- extensions/pi-gremlins/gremlin-scheduler.test.js` if Bun supports the filter in this repo; otherwise run `npm test`.

### Task 2 — Bound discovery file fan-out without changing discovery semantics
**What**
- Reuse the bounded async mapper for discovery work currently using `Promise.all` over file lists.
- Apply it to:
  - `fingerprintKnownFiles(...)` stat/read hashing work.
  - `loadDefinitionsFromFiles(...)` markdown definition loading.
- Use a separate module constant such as `DEFAULT_DISCOVERY_FILE_CONCURRENCY = 16`.
- Preserve sorted file processing and deterministic merged output order.

**References**
- `extensions/pi-gremlins/gremlin-discovery.ts`
- `extensions/pi-gremlins/gremlin-discovery.test.js`
- Optional helper file from Task 1

**Acceptance criteria**
- Targeted discovery concurrency test is written/updated first and fails before implementation for the expected unbounded fan-out contract mismatch.
- Discovery results are identical for user/project merge, override, diagnostics, and cache invalidation cases.
- Tests demonstrate active file-system calls/load operations are capped for a large file set.
- In-flight discovery de-duplication by discovery key still works.

**Guardrails**
- Do not change project-vs-user precedence.
- Do not change symlink inclusion defaults.
- Do not change fingerprint format unless tests prove cache behavior remains valid.

**Verification**
- Add a targeted discovery test with delayed fake file-system methods that tracks max concurrent calls.
- Before runtime edits, run the targeted discovery test and record the expected failure/contract mismatch.
- After the minimal discovery fix, rerun the same targeted test and confirm it passes.
- Run: `npm test -- extensions/pi-gremlins/gremlin-discovery.test.js` if available; otherwise run `npm test`.

### Task 3 — Remove duplicate small helpers safely
**What**
- Consolidate duplicate `extractTextFromContent` implementations into a shared utility with the existing side-chat behavior: strings return directly; text content arrays concatenate text items; non-text/unknown values return `""`.
- Suggested file: `extensions/pi-gremlins/gremlin-content-utils.ts`.
- Replace local copies in:
  - `extensions/pi-gremlins/gremlin-runner.ts`
  - `extensions/pi-gremlins/side-chat-command.ts`
  - `extensions/pi-gremlins/side-chat-transcript-state.ts`
- Replace duplicate `pushCacheEntry` in `extensions/pi-gremlins/gremlin-summary.ts` with existing `pushLimitedCache` from `extensions/pi-gremlins/gremlin-cache-utils.ts`.

**References**
- `extensions/pi-gremlins/gremlin-runner.ts`
- `extensions/pi-gremlins/side-chat-command.ts`
- `extensions/pi-gremlins/side-chat-transcript-state.ts`
- `extensions/pi-gremlins/gremlin-summary.ts`
- `extensions/pi-gremlins/gremlin-cache-utils.ts`
- New optional `extensions/pi-gremlins/gremlin-content-utils.ts`

**Acceptance criteria**
- Typecheck passes without `any`, `@ts-ignore`, or weakened typing.
- Existing runner and side-chat transcript tests still pass, including string content handling.
- Any targeted helper behavior tests are added/updated before helper changes and fail first if they expose a current contract mismatch.
- `gremlin-summary.ts` no longer has a private cache eviction duplicate.

**Guardrails**
- Preserve trimming at call sites exactly where currently applied; the shared helper should not trim unless all call sites already expect trimming.
- Do not remove exports unless import/reference search proves they are unused outside the file.

**Verification**
- Run: `npm run typecheck`.
- Run relevant tests: `npm test -- extensions/pi-gremlins/gremlin-runner.test.js extensions/pi-gremlins/side-chat-transcript-state.test.js extensions/pi-gremlins/side-chat-command.test.js` if filtering works; otherwise `npm test`.

### Task 4 — Fix side-chat pending-question overlap with minimal state change
**What**
- Replace `SideChatRuntime.lastSubmittedQuestion: string | null` with a per-mode pending question queue, e.g. `pendingQuestions: Record<SideChatMode, string[]>` or equivalent.
- On `submitSideChatPrompt`, append the submitted prompt to the active mode queue.
- On `finalizeExchange`, shift one question from the queue for that mode and persist that question with the current `lastAssistantText`.
- Clear pending queues for a mode when `:new` resets that mode; clear all runtime state on `session_start`/shutdown through `createRuntime()`.

**References**
- `extensions/pi-gremlins/side-chat-command.ts`
- `extensions/pi-gremlins/side-chat-command.test.js`
- `extensions/pi-gremlins/side-chat-transcript-state.ts` only if reducer test support is needed

**Acceptance criteria**
- Targeted side-chat overlap test is written first and fails before implementation for the expected question-order contract mismatch.
- Two submitted prompts in the same active session cannot cause the first persisted exchange to use the second question.
- Chat and tangent pending questions do not cross-contaminate.
- Existing overlay command registration, session reuse, parent snapshot capture, reset, and context filtering behavior remains unchanged.

**Guardrails**
- Do not rewrite overlay lifecycle or session factory behavior.
- Do not change command names, labels, persistence custom types, or transcript row shapes.
- Do not introduce persistence for incomplete/pending questions unless already completed by `turn_end`.

**Verification**
- Add a side-chat command test with a controllable fake session that accepts two prompts before emitting `turn_end`; assert persisted entries keep the correct question order.
- Before runtime edits, run that targeted side-chat test and record the expected failure/contract mismatch.
- After the minimal side-chat fix, rerun the same targeted test and confirm it passes.
- Run: `npm test -- extensions/pi-gremlins/side-chat-command.test.js` if available; otherwise `npm test`.

### Task 5 — Bound expanded render output
**What**
- Add module-local constants in `extensions/pi-gremlins/gremlin-render-components.ts` for expanded output limits, e.g. max lines per text field and max chars per rendered field.
- Apply bounding in `formatExpandedGremlinLines(...)` to large fields: `context`, `latestText`, `latestToolCall`, `latestToolResult`, and `errorMessage`.
- Keep collapsed rendering behavior unchanged.
- Preserve cache key correctness: include either revision or enough bounded text token data so updates do not reuse stale expanded lines.

**References**
- `extensions/pi-gremlins/gremlin-render-components.ts`
- `extensions/pi-gremlins/gremlin-rendering.ts`
- `extensions/pi-gremlins/gremlin-rendering.test.js`

**Acceptance criteria**
- Targeted expanded-render bounding test is written first and fails before implementation for the expected unbounded output contract mismatch.
- Expanded render output has deterministic upper bounds for very large/multiline fields.
- Truncated fields show an ellipsis or explicit omitted-lines marker.
- Existing collapsed rendering tests still pass.
- Existing expanded cache reuse tests still pass or are updated for intentional bounded output.

**Guardrails**
- Do not alter collapsed preview limits unless required by tests.
- Do not remove status, identity, cwd/model/thinking/phase, usage, or error visibility.
- Do not change public render function signatures.

**Verification**
- Add a rendering test that creates a gremlin entry with very large expanded fields and asserts output line count and line width/length are bounded.
- Before runtime edits, run that targeted rendering test and record the expected failure/contract mismatch.
- After the minimal rendering fix, rerun the same targeted test and confirm it passes.
- Run: `npm test -- extensions/pi-gremlins/gremlin-rendering.test.js` if available; otherwise `npm test`.

### Task 6 — Inspect public-facing concurrency wording
**What**
- Inspect `extensions/pi-gremlins/index.ts` gremlin tool description after bounded scheduling is implemented.
- If the description states or implies all requested gremlins run immediately/unbounded in parallel, update wording only enough to match bounded scheduling.
- If wording remains accurate, leave it unchanged.

**References**
- `extensions/pi-gremlins/index.ts`

**Acceptance criteria**
- Public-facing description is checked against bounded scheduling behavior.
- Wording is updated only if inaccurate after bounded scheduling.
- Tool schema, tool name, result shape, and 1..10 request bounds are unchanged.

**Guardrails**
- Do not change schema/tool name/result shape/request bounds.
- Do not make broader copy edits unrelated to scheduler accuracy.

**Verification**
- Inspect `extensions/pi-gremlins/index.ts` diff after the scheduler change.
- If wording changed, run the relevant index/tool registration tests if present; otherwise rely on `npm run typecheck` and `npm test` in Final Verification.

### Task 7 — Keep `gremlin-runner.ts` refactor small and behavior-preserving
**What**
- Limit runner maintainability work to the shared text utility from Task 3 and, only if it makes the patch clearer, extract one pure helper for event text/result projection already present in `projectGremlinEvent(...)`.
- Do not split session lifecycle, active session registry management, abort handling, or publishing into new services in this pass.

**References**
- `extensions/pi-gremlins/gremlin-runner.ts`
- `extensions/pi-gremlins/gremlin-runner.test.js`

**Acceptance criteria**
- Runner tests still prove event projection, streaming coalescing, abort, disposal, usage merge, and active session registration behavior.
- Diff in `gremlin-runner.ts` remains local and reviewable.

**Guardrails**
- Preserve async/cancellation semantics exactly.
- Do not change `RunSingleGremlinOptions`, `GremlinRunnerUpdate`, or run result shape.
- Do not hide type issues with casts to `any`.

**Verification**
- Run: `npm test -- extensions/pi-gremlins/gremlin-runner.test.js` if available; otherwise `npm test`.

## Final Verification
Run both required repository checks from the repo root:

```bash
npm run typecheck
npm test
```

Expected result: both commands pass.

## Open Risks / Unknowns
- **Unknown:** The exact safe defaults for internal concurrency limits may need adjustment after observing test/runtime behavior; suggested starting values are scheduler `4` and discovery file operations `16`.
- **Observed:** Current tests encode immediate full parallel scheduler startup, so tests must be intentionally updated to the new bounded-concurrency contract.
- **Inferred:** Side-chat overlap risk depends on prompt/turn timing in reused sessions; a controllable fake-session test should pin the intended queue behavior before implementation.
- **Inferred:** Expanded render bounding may require carefully chosen limits to avoid hiding useful error context while still preventing runaway output.
