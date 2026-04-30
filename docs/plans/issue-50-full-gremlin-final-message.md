# Issue 50 Implementation Plan: Return Full Gremlin Final Messages

## Objective

Fix GitHub issue [#50](https://github.com/magimetal/pi-gremlins/issues/50): the parent agent currently receives only the collapsed gremlin progress summary in the tool result `content`, so a gremlin's full final assistant message is truncated out of parent model context. Preserve existing inline summary/rendering behavior while adding untruncated terminal gremlin output to the model-visible tool result.

## Scope

- Runtime bugfix only; no PRD/ADR required unless implementation expands public schema or runtime architecture beyond this plan.
- Primary target: `extensions/pi-gremlins/gremlin-tool-execution.ts` return payload construction.
- Tests should prove the bug first, then verify the fix.
- UI renderer preview limits in `extensions/pi-gremlins/gremlin-render-components.ts` should remain unchanged.

## Evidence Collected

- Issue #50 body confirms `GremlinRunResult.latestText` preserves the full final message, while `executePiGremlinsTool()` returns only `batch.summary` in `content`.
- `extensions/pi-gremlins/gremlin-tool-execution.ts` currently returns `content: [{ type: "text", text: batch.summary }]` and sends the same final partial update.
- `extensions/pi-gremlins/gremlin-summary.ts` builds summaries through `formatCollapsedGremlinLines()`.
- `extensions/pi-gremlins/gremlin-render-components.ts` intentionally caps collapsed preview text at 96 chars and activity history previews at 3 lines.
- `extensions/pi-gremlins/gremlin-runner.ts` stores full final `message_end` text into `latestText`; only activity previews are capped at 512 chars.
- Existing execution-path tests live in `extensions/pi-gremlins/index.execute.test.js`; scheduler aggregation tests live in `extensions/pi-gremlins/gremlin-scheduler.test.js`.

## Assumptions

- The model-visible `AgentToolResult.content` may contain multiple `{ type: "text", text: string }` entries.
- Keeping `batch.summary` as the first content entry is safest for compatibility with existing expectations and inline final update behavior.
- Failed and canceled gremlins should expose full `errorMessage` in the result content even if their collapsed summary preview remains truncated.
- Empty or whitespace-only `latestText` should not add an empty final-message block.

## Implementation Tasks

### 1. Add failing tests for full terminal output in tool results

**What**

- Add or update tests in `extensions/pi-gremlins/index.execute.test.js` to prove the current bug before runtime edits.
- Cover these cases through the existing harness and mock child sessions:
  - single completed gremlin returns full `latestText` in `result.content`, including text longer than 96 chars and longer than 512 chars;
  - multi-gremlin execution returns each completed gremlin's full text with attribution by `gremlinId` and `agent`;
  - failed/unknown gremlin output includes the full `errorMessage` in model-visible content;
  - completed gremlin with no final text does not add a blank final-message block.

**References**

- `extensions/pi-gremlins/index.execute.test.js`
- `extensions/pi-gremlins/v1-contract-harness.js`
- `extensions/pi-gremlins/test-helpers.js`
- `extensions/pi-gremlins/gremlin-tool-execution.ts`

**Acceptance criteria**

- At least one new focused test fails before implementation because `result.content` only contains the collapsed summary.
- Tests assert the long final text appears untruncated in `result.content.map(part => part.text).join("\n")`.
- Tests assert the collapsed summary entry still exists and remains preview-formatted.
- Tests assert no empty final-output entry is produced when `latestText` is empty/missing.

**Guardrails**

- Do not depend on exact timestamps, activity revisions, or non-deterministic ordering outside gremlin input order.
- Do not change test harness behavior unless the existing harness cannot express the case.
- Do not weaken existing assertions that verify summary rendering.

**Verification**

- Run the focused failing test command before implementation:
  - `bun test extensions/pi-gremlins/index.execute.test.js`
- Expected pre-fix result: newly added full-output assertion fails because only `batch.summary` is returned.

### 2. Build model-visible terminal output from `GremlinRunResult` values

**What**

- In `extensions/pi-gremlins/gremlin-tool-execution.ts`, add a small local helper to create additional text content entries from final `batch.results`.
- Preserve the existing summary content entry first.
- For each result:
  - if `result.status === "completed"` and trimmed `result.latestText` is non-empty, append the full `latestText`;
  - if `result.status === "failed"` or `result.status === "canceled"` and trimmed `result.errorMessage` is non-empty, append the full `errorMessage`;
  - prefix each appended block with an attribution header such as `=== g1 · researcher ===`.
- Use `result.gremlinId ?? "g?"` and `result.agent` for attribution without mutating results.
- Reuse the same constructed `content` array for the final `onUpdate?.(partial)` and final returned `PiGremlinsToolResult` to avoid divergence.

**References**

- `extensions/pi-gremlins/gremlin-tool-execution.ts`
- `extensions/pi-gremlins/gremlin-schema.ts`
- `extensions/pi-gremlins/gremlin-summary.ts`

**Acceptance criteria**

- `batch.summary` remains present as `content[0].text`.
- Completed gremlin final messages are included exactly as stored in `result.latestText`, without collapsed-preview truncation or newline normalization.
- Multi-gremlin output is attributed by id and agent in input/result order.
- Failed/canceled gremlins include full `errorMessage` in model-visible content.
- No final-output block is emitted for completed gremlins with no non-whitespace final text.
- `details.gremlins[*].latestText` and existing summary generation remain unchanged.

**Guardrails**

- Do not modify `gremlin-runner.ts` unless tests show `latestText` is not actually full.
- Do not modify `gremlin-render-components.ts`; its 96-char preview limit is correct for inline UI.
- Do not change `GremlinRequestSchema`, `GremlinRunResult`, discovery, scheduler behavior, or public tool parameters.
- Do not add `as any`, `@ts-ignore`, or `@ts-expect-error`.

**Verification**

- Re-run focused tests:
  - `bun test extensions/pi-gremlins/index.execute.test.js`
- Inspect relevant assertions to confirm the long message survives beyond 96 and 512 characters.

### 3. Add/adjust unit coverage only if helper extraction warrants it

**What**

- If the content-building helper grows beyond a small local function, extract it to a narrowly named helper in `gremlin-tool-execution.ts` and export it only if direct tests are necessary.
- If exported, add direct tests for ordering, attribution, empty-text suppression, and error-message inclusion.
- After tests pass, confirm whether any newly exported helper has an import outside its defining file; if not needed, keep it unexported.

**References**

- `extensions/pi-gremlins/gremlin-tool-execution.ts`
- `extensions/pi-gremlins/index.execute.test.js`
- Optional only if required: new or existing `extensions/pi-gremlins/*tool-execution*.test.js`

**Acceptance criteria**

- Helper remains private unless direct unit testing provides clear value.
- Any export added for tests has at least one real import outside the source file or is removed before completion.
- Test coverage remains focused on issue #50 behavior, not broad formatting refactors.

**Guardrails**

- Do not introduce dead exports.
- Do not create a new abstraction layer around scheduler or renderer for this bugfix.
- Do not duplicate summary rendering logic.

**Verification**

- Search for new exports/imports if any helper is exported:
  - `rg "build.*Gremlin.*Content|format.*Gremlin.*Output|export function" extensions/pi-gremlins/gremlin-tool-execution.ts extensions/pi-gremlins/*.test.js`

### 4. Run full repository verification and dead-code cleanup check

**What**

- Run the project verification commands after implementation.
- Confirm no unrelated runtime files changed.
- Confirm no dead helper/export remains.

**References**

- `package.json`
- `extensions/pi-gremlins/gremlin-tool-execution.ts`
- `extensions/pi-gremlins/index.execute.test.js`
- Optional if touched: `extensions/pi-gremlins/*tool-execution*.test.js`

**Acceptance criteria**

- Typecheck passes.
- Bun tests pass.
- Combined check passes.
- `git diff --stat` shows changes limited to the implementation and tests needed for issue #50.
- Dead-code cleanup check finds no unused exported helper or obsolete test scaffolding.

**Guardrails**

- Do not commit, push, or open a PR in this workflow step.
- Do not edit docs/PRD/ADR/CHANGELOG unless implementation scope expands beyond a bugfix restoring intended behavior.
- Do not alter collapsed inline renderer output to satisfy model-visible result requirements.

**Verification**

- `npm run typecheck`
- `npm test`
- `npm run check`
- `git diff --stat`
- If exports changed: `rg "<newHelperName>" extensions/pi-gremlins`

## Target Files

- Change: `extensions/pi-gremlins/gremlin-tool-execution.ts`
- Test: `extensions/pi-gremlins/index.execute.test.js`
- Optional test/helper only if justified: `extensions/pi-gremlins/*tool-execution*.test.js`
- Do not change unless evidence contradicts issue analysis: `extensions/pi-gremlins/gremlin-runner.ts`, `extensions/pi-gremlins/gremlin-render-components.ts`, `extensions/pi-gremlins/gremlin-summary.ts`, `extensions/pi-gremlins/gremlin-schema.ts`

## Recommended Output Shape

Keep summary first, then one attributed full-output block per terminal gremlin with useful text:

```text
content[0].text = batch.summary
content[1].text = "=== g1 · researcher ===\n<full final assistant text>"
content[2].text = "=== g2 · reviewer ===\n<full final assistant text>"
```

For failed/canceled gremlins:

```text
"=== g2 · reviewer ===\n<full errorMessage>"
```

## Risks / Unknowns

- **Unknown:** exact Pi UI behavior when final `onUpdate` contains multiple text entries; keeping `batch.summary` first should limit risk.
- **Inferred:** Multiple content entries are acceptable because `AgentToolResult.content` is already an array of text content items.
- **Observed:** Existing renderer previews are intentionally truncated; changing them would be a UI behavior change and is not required for this issue.
