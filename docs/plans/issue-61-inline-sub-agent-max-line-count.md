# Issue 61 Plan: Bound Inline Sub-Agent Render Line Count

## Objective
Fix issue #61 end-to-end: collapsed inline gremlin/sub-agent tool results must never render more than the configured maximum visual line count during rapid high-volume output bursts, including wrapping long lines, and must not cause terminal UI fragments or layout corruption.

## Scope
- In scope: inline gremlin `tool.renderResult` update/render behavior, width-aware render component tests, entry-point render tests, changelog note, manual validation recipe, and git commit/push/PR steps authorized by the user-provided `git-issue-fix` workflow.
- Out of scope: child-session runtime architecture, discovery/schema behavior, side-chat/overlay renderers, PRD/ADR changes, and unrelated renderer refactors.

## Observed Context
- Root `AGENTS_CUSTOM.md` is referenced by generated `AGENTS.md` but is absent in this worktree; use root `AGENTS.md`, `extensions/pi-gremlins/AGENTS.md`, and `docs/AGENTS.md` as available repo instructions.
- `extensions/pi-gremlins/index.ts` currently returns `new Text(...)` directly from `tool.renderResult`, so the full collapsed/expanded text can be handed to the TUI without a final width-aware visual-line cap.
- `extensions/pi-gremlins/gremlin-render-components.ts` bounds per-entry collapsed previews but not total result visual lines across many gremlins, many updates, or a single long wrapping line.
- Pi exposes visual truncation behavior via `truncateToVisualLines` in `@mariozechner/pi-coding-agent`; built-in renderers should be inspected first for the configured collapsed preview line count/source before adding a local constant.

## Required Decisions Before Implementation
1. **Configured max source:** Inspect Pi's renderer exports/types and built-in tool renderers for an existing configured collapsed max line count. Prefer the upstream value/export if accessible. If no accessible value exists, define a private gremlin-only constant near the render boundary (for example `INLINE_RESULT_PREVIEW_LINES = 20`) and document that it mirrors Pi collapsed preview behavior.
2. **Cap scope:** Apply the issue #61 hard cap to collapsed inline rendering (`expanded: false`) including partial updates. Do not cap expanded mode unless inspection shows Pi's tool-render contract requires expanded views to obey the same configured maximum; if expanded remains uncapped, add/keep an explicit regression assertion or code comment proving this is intentional.
3. **Primary regression level:** The primary regression must exercise `createPiGremlinsExtension().tool.renderResult` or the component returned by that entry point, render it at a narrow width, and assert rendered visual line count is `<= max`. Pure string-helper tests are supporting coverage only.

## Task 1 — Discover the configured max and render contract
### What
Inspect the Pi package renderer utilities, types, and built-in renderer usage to identify the authoritative maximum line count and whether the cap applies only collapsed or also expanded.

### References
- `node_modules/@mariozechner/pi-coding-agent/dist/modes/interactive/components/visual-truncate.js`
- `node_modules/@mariozechner/pi-coding-agent/dist/**` renderer/type files found by search
- `extensions/pi-gremlins/index.ts`
- `extensions/pi-gremlins/gremlin-render-components.ts`

### Acceptance Criteria
- Implementation notes identify the exact upstream configured max source/export, or state that no accessible source exists and name the local private fallback constant.
- Collapsed vs expanded cap scope is explicitly recorded in code comments or tests.
- No public user configuration is added unless Pi already exposes a matching renderer option.

### Guardrails
- Do not change schema, discovery, child-session config, or final model-visible tool result content.
- Do not import from unstable deep Pi internals if a public/exported helper exists; if a deep behavior reference is used, keep it test-backed and localized.
- Do not introduce `as any`, `@ts-ignore`, or `@ts-expect-error`.

### Verification
- Readback of the selected source/constant in the implementation diff.
- Tests in later tasks reference the same max source/constant, not a duplicated magic number.

## Task 2 — Add the failing entry-point regression first
### What
Add a regression test at the `tool.renderResult`/component level that fails before the fix because collapsed output exceeds the configured maximum visual line count.

### References
- `extensions/pi-gremlins/index.render.test.js`
- `extensions/pi-gremlins/v1-contract-harness.js`
- `extensions/pi-gremlins/index.ts`

### Acceptance Criteria
- Test calls `createPiGremlinsExtension().tool.renderResult(result, { expanded: false, isPartial: true }, context)` or the existing harness equivalent.
- Test renders the returned component at a narrow representative width, such as 24-40 columns, and asserts `component.render(width).length <= configuredMax`.
- Test fixture includes both:
  - many gremlin entries/updates sufficient to exceed the cap by aggregate line count, and
  - at least one very long unbroken or minimally spaced line that wraps into multiple visual lines at the chosen width.
- Test also asserts the truncation hint, if present, is included inside the maximum: total rendered visual lines including hint are `<= configuredMax`.
- Expected pre-fix failure is too many rendered visual lines from the entry-point returned component.

### Guardrails
- Do not rely on `text.split("\n")` alone; use component `render(width)` or equivalent width-aware output.
- Do not assert against ANSI color codes unless style is the behavior under test.
- Do not use sleeps/timing to simulate bursts; represent burst state with dense `details` snapshots.

### Verification
- `bun test extensions/pi-gremlins/index.render.test.js`
- Expected before implementation: new regression fails for line count overflow.

## Task 3 — Implement a bounded collapsed inline result component
### What
Change the inline `renderResult` path so collapsed gremlin results render through a width-aware bounded component. Reuse Pi's `truncateToVisualLines` if accessible; otherwise add a small local equivalent using `Text.render(width)` semantics.

### References
- `extensions/pi-gremlins/index.ts`
- `extensions/pi-gremlins/gremlin-rendering.ts`
- `extensions/pi-gremlins/gremlin-render-components.ts`
- `node_modules/@mariozechner/pi-coding-agent/dist/modes/interactive/components/visual-truncate.js` (behavior reference only)

### Acceptance Criteria
- Collapsed `tool.renderResult(..., { expanded: false, isPartial: true })` never renders more than the configured max visual lines for burst snapshots.
- Long lines that wrap in narrow terminals count toward the same cap.
- Truncation hint text, such as skipped-line count plus `Ctrl+O` expand affordance, is appended/replaced so the final rendered output including the hint still remains `<= configuredMax`.
- Existing style/color behavior is preserved as far as possible after truncation.
- Full model-visible tool result content remains unchanged; only UI rendering is bounded.
- Expanded mode is either intentionally uncapped with test/comment coverage, or capped only if Task 1 proves Pi requires it.

### Guardrails
- Keep the fix scoped to inline gremlin rendering; do not change scheduler, runner, progress store, schema, child session, discovery, or final tool content semantics unless inspection proves direct responsibility.
- Do not add a public configuration surface unless the existing Pi tool renderer already supplies one.
- Do not remove stable gremlin IDs, usage rows, collapsed context/activity limits, or render cache invalidation semantics.
- Keep helper exports private unless an external import is required by tests; if exporting a helper/constant, confirm at least one import exists outside the defining file.

### Verification
- `bun test extensions/pi-gremlins/index.render.test.js`
- `bun test extensions/pi-gremlins/gremlin-rendering.test.js`

## Task 4 — Add supporting renderer/helper coverage
### What
Add focused tests for the renderer/helper behavior that complements the entry-point regression without replacing it.

### References
- `extensions/pi-gremlins/gremlin-rendering.test.js`
- `extensions/pi-gremlins/gremlin-rendering.ts`
- `extensions/pi-gremlins/gremlin-render-components.ts`

### Acceptance Criteria
- Test covers many gremlins where aggregate collapsed content would exceed the max.
- Test covers a single long wrapping line at a narrow width.
- Test verifies truncation hint placement/count does not push rendered visual lines beyond the cap.
- Existing summary, stable ID, usage, and collapsed detail limit assertions continue passing.

### Guardrails
- Keep pure string helper expectations separate from component `render(width)` visual-line expectations.
- Do not weaken existing rendering contract assertions.

### Verification
- `bun test extensions/pi-gremlins/gremlin-rendering.test.js`

## Task 5 — Manual burst validation recipe
### What
Document a manual verification procedure for a rapid high-volume gremlin output burst in the PR body or implementation notes.

### References
- `README.md` only if an existing developer verification section is already suitable; otherwise PR body is enough.
- `extensions/pi-gremlins/index.ts`
- Pi TUI running with this package installed from the issue branch.

### Acceptance Criteria
- Procedure invokes `pi-gremlins` with multiple gremlins producing many text/tool-result updates rapidly.
- Tester records terminal width, configured max line cap/source, collapsed/expanded state, and whether terminal fragments/layout corruption occurred.
- Manual result states whether collapsed inline view remained within max line count throughout the burst and whether stale fragments were observed.

### Guardrails
- Do not add production-only diagnostics or artificial sleeps just for manual testing.
- Do not require external services beyond normal Pi model/provider availability.
- Do not claim manual validation in changelog/PR unless it was actually performed.

### Verification
- Manual TUI check after automated tests pass, or PR body explicitly marks it unperformed with reason.

## Task 6 — Changelog and release note
### What
Add an Unreleased `Fixed` bullet for issue #61.

### References
- `CHANGELOG.md`

### Acceptance Criteria
- Bullet is under `## [Unreleased]` / `### Fixed`.
- Bullet mentions issue #61 and summarizes the bounded collapsed inline gremlin render fix.
- No PRD/ADR references are added because this is a scoped bugfix restoring expected render behavior.

### Guardrails
- Do not reorder unrelated changelog entries.
- Do not claim manual validation unless performed.

### Verification
- Read `CHANGELOG.md` and confirm the new bullet is in the correct section.

## Task 7 — Final verification, commit, push, and PR
### What
Run focused and full checks, inspect the diff, then commit, push, and open/prepare the PR as authorized by the user-provided end-to-end `git-issue-fix` workflow for issue #61.

### References
- `package.json`
- `extensions/pi-gremlins/*.test.js`
- `CHANGELOG.md`
- GitHub issue #61

### Acceptance Criteria
- Focused tests pass:
  - `bun test extensions/pi-gremlins/index.render.test.js`
  - `bun test extensions/pi-gremlins/gremlin-rendering.test.js`
- Full relevant checks pass:
  - `npm run typecheck`
  - `npm test`
  - `npm run check`
- `git diff --check` passes.
- Commit message references issue #61, e.g. `fix: cap inline gremlin render lines`.
- Branch is pushed and PR is opened or prepared according to available credentials/tooling.
- PR body includes automated verification, manual burst validation status, configured max source, collapsed/expanded cap scope, and issue close reference.

### Guardrails
- Commit/push/PR are permitted here only because the caller supplied an end-to-end `git-issue-fix` workflow requesting those actions; do not perform destructive git operations.
- Do not commit generated artifacts, `node_modules`, or unrelated docs/source changes.
- Do not merge/rebase/destructively reset without explicit instruction.
- If verification fails, fix or report the exact blocker before opening PR.

### Verification
- `git status --short`
- `git diff --check`
- `npm run check`
- PR URL or explicit blocker if PR creation is unavailable.

## Suggested Implementation Shape
1. Discover or define the collapsed max line constant once. Prefer an existing Pi configured value/export if accessible; otherwise add a local private constant near the render boundary, e.g. `INLINE_RESULT_PREVIEW_LINES = 20`, with a comment noting the inspected Pi behavior it mirrors.
2. Introduce a small render component for gremlin results that:
   - caches by width and styled text,
   - uses `truncateToVisualLines(styledText, maxLines, width, paddingX)` or local equivalent for collapsed mode,
   - reserves one visual line for a truncation hint before truncating content so hint + content never exceed `maxLines`,
   - returns full rendered lines for expanded mode unless Task 1 proves expanded mode must also be capped,
   - invalidates its cache on update.
3. Keep `renderGremlinInvocationText` pure/string-based so existing unit tests and summary behavior remain stable; apply visual-line limiting at the `index.ts` component boundary where width is known.
4. Make the entry-point `index.render.test.js` regression the canonical proof, then add renderer/helper tests for edge cases.

## Open Risks / Unknowns
- **Unknown:** No `maxLines` field has been confirmed on `ToolRenderResultOptions`; implementation must inspect installed Pi files before choosing upstream source vs local fallback.
- **Inferred:** The bug likely comes from returning an unbounded `Text` component from `index.ts`, not from progress-store update ordering.
- **Unknown:** Automated tests can prove rendered visual line counts, but true terminal fragment/layout corruption still benefits from manual TUI burst validation.
