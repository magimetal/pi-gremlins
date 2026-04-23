# Plan: Pi Gremlins Inline Progress UX Remediation

- **Status:** Implemented and verified.
- **Date:** 2026-04-22
- **Scope:** `extensions/pi-gremlins/*`
- **Related scope:** stays inside PRD-0002 inline-progress requirement. No new popup/viewer/command surface.
- **Verification target:** `npm run typecheck` and focused Bun rendering/execution tests

## User-reported problems

1. Inline gremlin output hard to read.
2. Collapsed state shows far too much content.
3. At least one running gremlin looked stalled because visible output stopped changing while work continued.

## Confirmed findings

### Finding 1 - collapsed preview leaks raw multiline payloads

- **Where:** `extensions/pi-gremlins/gremlin-render-components.ts`
- **What:** `normalizeText()` only trims. It does not flatten embedded newlines or compress whitespace. `formatCollapsedGremlinLine()` then joins raw assistant/tool text into one string.
- **Why it matters:** one tool result with embedded newlines can explode collapsed mode into many terminal lines. That matches user report: collapsed row can look like dozens of lines.
- **Evidence path:** new regression test in `extensions/pi-gremlins/gremlin-rendering.test.js`

### Finding 2 - live tool activity gets hidden behind stale assistant text

- **Where:** `extensions/pi-gremlins/gremlin-render-components.ts#formatGremlinActivity`
- **What:** renderer always prefers `latestText` over `latestToolResult` and `latestToolCall`.
- **Why it matters:** once gremlin emits any assistant text, later tool execution can be active while collapsed preview still shows old prose. User sees phase maybe change, but visible detail looks frozen. This matches "kept working but stopped showing output."
- **Evidence path:** new regression tests in `extensions/pi-gremlins/gremlin-rendering.test.js` and `extensions/pi-gremlins/index.execute.test.js`

### Finding 3 - current renderer gives weak visual separation between state types

- **Where:** `extensions/pi-gremlins/index.ts`, `extensions/pi-gremlins/gremlin-render-components.ts`, `extensions/pi-gremlins/gremlin-rendering.ts`
- **What:** status, identity, tool call, tool result, and assistant text all render as same plain text treatment. No theme color, no badge hierarchy, no explicit preview labels in collapsed mode.
- **Why it matters:** tool start, tool result, and assistant narration visually blur together. User must parse punctuation instead of scanning structure.
- **Evidence path:** code inspection plus Pi extension/TUI docs. Automated tests can prove structure bugs; final readability pass still needs manual interactive validation.

## Root-cause summary

Current system has two separate problems stacked together:

1. **Content selection bug:** wrong field wins in collapsed preview.
2. **Presentation bug:** raw text gets injected with almost no sanitization or visual hierarchy.

Because both happen in same render path, live progress feels noisy when payload is large and stale when tool activity changes.

## Remediation plan

### Step 1 - fix collapsed preview data selection

- Add explicit preview-priority rules in `gremlin-render-components.ts`.
- Proposed priority for active gremlins:
  - failed/canceled => `errorMessage`
  - `currentPhase` starts with `tool:` and `latestToolResult` exists => show tool result preview
  - `currentPhase` starts with `tool:` and `latestToolCall` exists => show tool call preview
  - `latestText` when phase is streaming/settling and text differs from task context
  - fallback to task context
- Keep expanded mode showing all fields separately.

### Step 2 - sanitize preview text for collapsed mode

- Add preview-normalization helper for collapsed rendering:
  - flatten `\r`/`\n` to spaces
  - collapse repeated whitespace
  - trim
  - clamp preview length before width clamp so one payload cannot dominate row
- Apply same helper to assistant text, tool call text, tool result text, error text in collapsed mode.
- Preserve raw text in expanded mode.

### Step 3 - reduce collapsed footprint deliberately

- Keep collapsed output to:
  - 1 headline line
  - 1 preview line per gremlin
  - 1 compact expand hint
- No multiline preview fragments in collapsed mode.
- If preview must truncate, use explicit ellipsis rather than wrapped spill.

### Step 4 - add visual hierarchy with theme-aware rendering

- Use `renderResult(result, options, theme, context)` theme parameter instead of plain unstyled text assembly only.
- Color/status treatment target:
  - status badge color by state
  - gremlin identity in accent/muted split
  - explicit preview labels for collapsed tool states, eg `tool`, `result`, `text`
  - muted metadata in expanded mode
- Keep output inside built-in tool row. No popup, no overlay.
- Reuse `Text` component first. Only move to custom component if width control or line clamping needs stronger guarantees.

### Step 5 - verify live partial-update behavior end-to-end

- Ensure partial updates rendered during `onUpdate` use same preview rules as final row render.
- Re-run focused execute test with event sequence: text delta -> tool start -> tool end -> message end.
- Manual interactive check after code lands:
  - one gremlin with multiline tool output
  - one gremlin that speaks, then runs tools for long time
  - multiple parallel gremlins with mixed statuses

## Test plan and implementation evidence

### Regressions added first

- `extensions/pi-gremlins/gremlin-rendering.test.js`
  - collapsed preview must stay one visible line per gremlin even when tool output is multiline
  - collapsed preview must surface live tool call after earlier assistant text
- `extensions/pi-gremlins/index.execute.test.js`
  - streaming update text must switch to tool activity after early assistant text

### Result after fix

These regressions now pass after renderer changes in `gremlin-render-components.ts`, `gremlin-rendering.ts`, and `index.ts`.

## Acceptance criteria for implementation

- Collapsed mode never expands raw multiline tool or assistant payload into many lines.
- Active tool call/result becomes visible in collapsed mode even after earlier assistant narration.
- Collapsed mode remains compact and scannable with multiple concurrent gremlins.
- Expanded mode still exposes full task/tool/result metadata.
- Theme-aware styling makes status/tool/result/text visually distinct in interactive TUI.
- Focused regressions pass.

## Risks

- Over-sanitizing expanded mode would destroy useful detail. Keep raw detail expanded-only.
- Over-styling with pre-baked ANSI needs proper invalidation on theme change. Pi TUI docs call this out explicitly.
- Truncation rules must not hide terminal errors. Error previews must still win.
