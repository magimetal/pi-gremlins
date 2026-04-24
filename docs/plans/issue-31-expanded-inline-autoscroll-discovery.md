# Discovery: Issue 31 Expanded Inline Autoscroll

- **Status:** Discovery complete. No `pi-gremlins` code change recommended yet.
- **Date:** 2026-04-23
- **Scope:** `extensions/pi-gremlins/index.ts`, `extensions/pi-gremlins/gremlin-rendering.ts`, Pi tool execution renderer, Pi TUI viewport renderer
- **GitHub issue:** #31 - prevent expanded inline view from auto-scrolling to bottom on new items
- **Verification target:** Readback and consistency checks only. Documentation-only artifact.

## Question

Can `pi-gremlins` prevent expanded inline progress updates from yanking terminal viewport to bottom when user has scrolled up, while preserving follow-tail behavior when user is already near bottom?

## Answer

No extension-only fix is currently available for real terminal scrollback position.

`pi-gremlins` can choose collapsed versus expanded text content, but it cannot observe whether user is scrolled up in terminal scrollback and cannot tell Pi TUI to preserve current scroll offset during partial tool-result updates. Actual scroll movement is controlled below extension layer by Pi TUI render diff logic.

## Evidence

### `pi-gremlins` renderer only selects text content

- **Where:** `extensions/pi-gremlins/index.ts`
- **Observed:** `renderResult()` receives Pi `options`, reads `options.expanded`, builds text through `renderGremlinInvocationText()`, styles it, and returns `new Text(...)`.
- **Impact:** Extension can change number/content of rendered lines, but has no viewport or pinned-to-bottom signal.

Relevant behavior:

```ts
const text = renderGremlinInvocationText(getInvocationDetails(result), {
	expanded: options.expanded,
});
return new Text(styleGremlinInvocationText(text, theme, options));
```

### Expanded output is static line construction

- **Where:** `extensions/pi-gremlins/gremlin-rendering.ts`
- **Observed:** `renderGremlinInvocationText()` chooses `buildExpandedLines()` when `options.expanded` is true. It returns newline-joined text after cache and width clamping.
- **Impact:** Expanded view has no interactive scroll model. It is plain lines inside Pi tool row.

### Tool result renderer API does not expose scroll state

- **Where:** `node_modules/@mariozechner/pi-coding-agent/dist/core/extensions/types.d.ts`
- **Observed:** `ToolRenderResultOptions` contains only `expanded` and `isPartial`. `ToolRenderContext` contains args, toolCallId, invalidation callback, last component, renderer state, cwd, execution flags, image flag, and error flag.
- **Impact:** Custom tool renderers cannot know terminal scrollback position, previous viewport top, or whether user is pinned to bottom.

### Pi `ToolExecutionComponent` passes only render state, not viewport state

- **Where:** `node_modules/@mariozechner/pi-coding-agent/dist/modes/interactive/components/tool-execution.js`
- **Observed:** `resultRenderer()` is called with `{ expanded: this.expanded, isPartial: this.isPartial }` and `getRenderContext(...)`.
- **Impact:** Even custom components have no public hook to negotiate viewport preservation during `updateResult()`.

### TUI owns viewport movement and CRLF scroll

- **Where:** `node_modules/@mariozechner/pi-tui/dist/tui.js`
- **Observed:** `doRender()` tracks `previousViewportTop` internally. When changed/appended content target row is below previous viewport bottom, it emits `"\r\n".repeat(scroll)`, advances `prevViewportTop`, and writes buffer to terminal.
- **Impact:** Incoming partial updates that grow line count can force terminal scroll at TUI layer. Extension renderer cannot prevent this without reducing line growth or avoiding inline updates.

Relevant behavior:

```js
if (moveTargetRow > prevViewportBottom) {
	const scroll = moveTargetRow - prevViewportBottom;
	buffer += "\r\n".repeat(scroll);
	prevViewportTop += scroll;
	viewportTop += scroll;
	hardwareCursorRow = moveTargetRow;
}
```

### TUI component docs do not expose terminal scrollback

- **Where:** `/Users/magimetal/.nvm/versions/node/v24.14.0/lib/node_modules/@mariozechner/pi-coding-agent/docs/tui.md`
- **Observed:** Public component interface is `render(width)`, optional `handleInput(data)`, optional `wantsKeyRelease`, and `invalidate()`.
- **Impact:** Components can implement their own internal scrolling when focused, but cannot read or preserve host terminal scrollback offset.

## Options considered

### Option 1 - Extension-only line reduction

- **What:** Keep expanded output smaller, throttle partial line growth, or cap live expanded history.
- **Pros:** Can be implemented entirely in `pi-gremlins`.
- **Cons:** Does not solve actual requested behavior. User still gets yanked when total rendered output grows beyond viewport. Reduces detail in expanded view.
- **Verdict:** Not sufficient for issue #31.

### Option 2 - Custom interactive component inside tool row

- **What:** Replace plain `Text` with component that maintains its own internal scroll offset and handles keys.
- **Pros:** Could preserve scroll inside component-owned content.
- **Cons:** Tool row focus/input routing and terminal scrollback still do not expose user scroll position. This changes interaction model and may conflict with standard `Ctrl+O` expanded affordance.
- **Verdict:** Higher risk and still not true terminal scrollback preservation.

### Option 3 - Pi runtime sticky-bottom / preserve-viewport policy

- **What:** Add support in Pi TUI or tool-execution layer to know whether viewport is pinned to bottom. When not pinned, avoid CRLF auto-scroll on appended/updated lines and preserve current viewport top. Resume follow-tail when user returns to bottom.
- **Pros:** Directly matches desired behavior for all streaming inline tool results, not only `pi-gremlins`.
- **Cons:** Requires Pi runtime/TUI change outside this package.
- **Verdict:** Recommended path.

## Recommended implementation path

Make a minimal Pi runtime change, not a `pi-gremlins` extension change:

1. Track pinned-to-bottom in TUI/tool-execution render path when user-controlled viewport state is available.
2. Add opt-in policy, for example `preserveViewportWhenUnpinned` or `scrollPolicy: "follow-when-pinned"`, on tool render/update path.
3. In `TUI.doRender()`, when appended lines extend beyond viewport:
   - if pinned to bottom, keep current behavior and emit CRLF to follow latest output;
   - if not pinned, avoid advancing viewport via CRLF and preserve previous viewport top;
   - when user scrolls back to bottom, resume follow-tail.
4. Expose policy through public tool rendering API or tool execution options so `pi-gremlins` can opt in without knowing terminal internals.

## Acceptance criteria for future runtime fix

- User near bottom of expanded inline tool result: new gremlin updates keep following latest output.
- User scrolled up in terminal scrollback: new gremlin updates do not move viewport to bottom.
- User returns to bottom manually: follow-tail resumes.
- Behavior works for partial updates and final result updates.
- Public API does not expose raw terminal escape handling to extensions.

## Current recommendation for this repository

Do not change `extensions/pi-gremlins/*` for issue #31 yet. Record discovery result, then open/follow upstream Pi runtime issue or PR for sticky-bottom/preserve-viewport behavior. After Pi exposes a policy or callback, add a narrow `pi-gremlins` opt-in if needed.

## Verification

- Read `extensions/pi-gremlins/index.ts` and confirmed renderer only consumes `expanded` from render options.
- Read `extensions/pi-gremlins/gremlin-rendering.ts` and confirmed expanded output is newline text construction.
- Read Pi `ToolRenderResultOptions` / `ToolRenderContext` definitions and confirmed no scrollback or viewport API.
- Read Pi `ToolExecutionComponent` render path and confirmed result renderer receives `expanded` and `isPartial` only in options.
- Read Pi TUI `doRender()` diff path and confirmed internal `previousViewportTop` plus CRLF scroll behavior.
- Read Pi TUI docs and confirmed component interface exposes rendering/input/invalidation, not terminal viewport state.
