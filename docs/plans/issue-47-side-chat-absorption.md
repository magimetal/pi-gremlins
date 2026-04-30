# Plan: Issue #47 — Pi Gremlins Side-Chat Absorption (`/gremlins:chat`, `/gremlins:tangent`)

## Goal

Land `/gremlins:chat` and `/gremlins:tangent` inside `extensions/pi-gremlins/`,
backed by the existing in-process SDK gremlin session factory primitives, with
zero tools, fresh-per-invocation sessions, inline rendering, parent-transcript
seeding for `/gremlins:chat` only, and full ADR-0003 isolation. Ship README and
CHANGELOG updates required by PRD-0004 / ADR-0004 acceptance criteria. Capture
`pi-gizmo` deprecation as a post-merge cross-package coordination checklist
(out of this PR's scope, but tracked here so the absorption is not considered
done until those items execute).

## References

- GitHub issue: <https://github.com/magimetal/pi-gremlins/issues/47>
- PRD: `docs/prd/0004-pi-gremlins-side-chat-absorption-and-pi-gizmo-deprecation.md`
- ADR: `docs/adr/0004-side-chat-absorption-from-pi-gizmo.md`
- Prior decisions reused: ADR-0002 (in-process SDK runtime), ADR-0003 (isolation contract)
- Touched code (anchors):
  - `extensions/pi-gremlins/index.ts` (extension entry, registers commands via `pi.registerCommand`)
  - `extensions/pi-gremlins/gremlin-session-factory.ts`
    (`buildGremlinSessionConfig`, `createIsolatedGremlinResourceLoader`,
    `createEmptyGremlinResources`, `createGremlinSession`,
    `resolveGremlinModel`, `resolveGremlinThinking`)
  - `extensions/pi-gremlins/gremlin-prompt.ts` (`buildGremlinPrompt`)
  - `extensions/pi-gremlins/gremlin-runner.ts` (event projection patterns; reused only for inspiration, not imported)
- Pi platform anchors (read-only):
  - `node_modules/@mariozechner/pi-coding-agent/dist/core/extensions/types.d.ts`
    — confirmed `ExtensionAPI.registerCommand(name, { description?, handler:
    (args, ctx: ExtensionCommandContext) => Promise<void> })`,
    `pi.sendMessage({ customType, content, display, details })`,
    `pi.registerMessageRenderer(customType, renderer)`, and `ctx.ui.notify`.
  - `node_modules/@mariozechner/pi-coding-agent/dist/core/session-manager.d.ts`
    — confirmed `ReadonlySessionManager.getBranch()` returns
    `SessionEntry[]`, with `SessionMessageEntry { type: "message", message:
    AgentMessage }`. This is the parent-transcript snapshot source.

**Confirmed command-registration API by inspection (Observed):**
`pi.registerCommand("gremlins:primary", { description, handler })` is already
used in `extensions/pi-gremlins/index.ts` (line 139). Side-chat will register
through the same symbol; no new mechanism required (ADR-0004 D6).

## Out-of-Scope (mirrors PRD-0004)

- Thread persistence across invocations (Q1; PRD non-goal).
- Overlay/popup UI for side-chat (Q2; PRD non-goal; ADR-0004 D1).
- Inject/handoff between side-thread and parent (Q3; PRD non-goal).
- Tool access inside side-thread (Q4; PRD non-goal; ADR-0004 D4).
- Porting `pi-gizmo` source (Q5; PRD non-goal; ADR-0004 D5).
- Per-side-thread model/thinking overrides, recap, summarize, inject, clear, new (replacements for `gizmo:model`, `gizmo:thinking`, `gizmo:recap`, `gizmo:summarize`, `gizmo:inject`, `gizmo:clear`, `gizmo:new`).
- Reviving nested Pi CLI subprocess runtime, temp prompt files, chain mode, or popup viewer.
- Removing `pi-gizmo` package code in this repo (it lives in a separate repo); only docs in *this* repo gain the migration table. Actual `pi-gizmo` repo edits are POST-MERGE.
- Changes to gremlin delegation tool schema (PRD-0002) or primary-agent selection (PRD-0003).

## Step-by-Step Tasks

### Task 1 — Pre-implementation evidence pass (NO CODE)

- **What:** Before adding modules, the implementer must confirm the parent-transcript shape exposed to a command handler.
- **References:**
  - `extensions/pi-gremlins/index.ts:110` (`ctx.sessionManager.getBranch()` already used).
  - `node_modules/@mariozechner/pi-coding-agent/dist/core/session-manager.d.ts` — `SessionEntry`, `SessionMessageEntry`, `ReadonlySessionManager.getBranch`.
  - `node_modules/@mariozechner/pi-agent-core` — `AgentMessage` type (role + content parts).
- **Action:** run `fff-multi-grep`-style searches (or plain `grep -rn`) for `getBranch`, `SessionMessageEntry`, `AgentMessage`, `messages`, `transcript`, `history`, and `getEntries` across `node_modules/@mariozechner/pi-coding-agent/dist` and `node_modules/@mariozechner/pi-agent-core/dist`. Confirm:
  1. `ctx.sessionManager.getBranch()` returns the linear branch from root to current leaf as `SessionEntry[]`.
  2. `SessionMessageEntry.message` is the `AgentMessage` whose `role` and `content` (string or `(TextContent | ImageContent)[]`) are stable across the v0.69 surface.
- **Strategy chosen (Inferred but supported):** capture parent transcript at command-handler invocation time via `ctx.sessionManager.getBranch()`, filter to `entry.type === "message"`, and project to a plain `Array<{ role, text }>` snapshot. Strategy (a) — read from extension hook context — is rejected because command handlers do not receive a `before_agent_start`-style message array; strategy (b) — snapshot at command-handler invocation — matches ADR-0004 D3 ("snapshot of the parent transcript at invocation time").
- **Fail-fast contract:** if `ctx.sessionManager` is missing, `getBranch()` throws, or the entries cannot be coerced to a non-empty `Array<{ role, text }>`, `/gremlins:chat` MUST print a usage hint via `ctx.ui.notify(..., "warning")` and exit cleanly without starting a session. Document this gap as a follow-up (`docs/plans/`-style FIXME at the top of `side-chat-command.ts`) instead of guessing.
- **Acceptance:** notes added inline to the new modules' header comments citing the exact symbol names confirmed; no implementation written yet.
- **Guardrail:** do not modify any file in this task.
- **Verification:** the implementer logs the confirmed symbols in the PR description before merging Task 2.

### Task 2 — Add `extensions/pi-gremlins/side-chat-session-factory.ts`

- **What:** New module that produces an isolated, **zero-tool** SDK session for one side-chat invocation, layered on `gremlin-session-factory.ts` primitives. Does NOT import or modify the gremlin factory's public surface — it composes it.
- **Exports (named):**
  - `interface ParentTranscriptSnapshot { entries: Array<{ role: "user" | "assistant"; text: string }>; capturedAt: string; }`
  - `interface BuildSideChatSessionConfigOptions { mode: "chat" | "tangent"; userPrompt: string; parentSnapshot?: ParentTranscriptSnapshot; parentModel?: string | Model<any>; parentThinking?: ThinkingLevel; cwd?: string; modelRegistry?: ModelRegistry; }`
  - `interface SideChatSessionConfig { systemPrompt: string; prompt: string; model?: string; resolvedModel?: Model<any>; thinking?: ThinkingLevel; tools: []; cwd?: string; resources: ReturnType<typeof createEmptyGremlinResources>; resourceLoader: ResourceLoader; usesSubprocess: false; writesTempPromptFile: false; }`
  - `function buildSideChatSessionConfig(options): SideChatSessionConfig`
  - `function createSideChatSession(options): Promise<CreateAgentSessionResult>` — thin wrapper that calls `createGremlinSession` (re-exported through composition) with `tools: []` forced.
  - `const SIDE_CHAT_SYSTEM_PROMPT_CHAT` / `_TANGENT` (constants — small, explicit; do not load from disk; enforces ADR-0003 "no parent extensions, prompts, themes, skills, AGENTS.md, primary-agent markdown leaks").
- **Internal contracts (must be unit-asserted in Task 5):**
  - `tools` is the empty array `[]` (NOT `undefined`) — pi-coding-agent treats `undefined` as "default" but `[]` as "explicitly none". Verify this against
    `node_modules/@mariozechner/pi-coding-agent/dist/core/agent-session.d.ts` before relying on it; if `[]` does not disable tools, fall back to passing an explicit tool-allowlist filter and document.
  - `resources` uses `createEmptyGremlinResources()` from the gremlin factory — same isolation primitive ADR-0003 locked.
  - `resourceLoader` uses `createIsolatedGremlinResourceLoader(systemPrompt)` from the gremlin factory.
  - `mode === "tangent"` MUST ignore `parentSnapshot` even if supplied (defensive). Test asserts this.
  - `mode === "chat"` MUST embed `parentSnapshot` only inside the `prompt` field, never inside `systemPrompt`, and never as a tool, resource, or extension. The prompt embedding format is fixed (see below) so tests can grep it.
  - `model` and `thinking` resolution reuse `resolveGremlinModel` / `resolveGremlinThinking` with `frontmatter` synthesized as `{}` (no per-side-chat overrides per Q5/D8).
- **Prompt format (fixed):**
  - `systemPrompt`: `SIDE_CHAT_SYSTEM_PROMPT_CHAT` or `SIDE_CHAT_SYSTEM_PROMPT_TANGENT`. Contents are ~4-8 lines: identity ("You are a side-chat conversational assistant for the Gremlins🧌 host session."), no-tools statement, no-workspace-mutation guarantee, terse-by-default guidance. No reference to gremlin delegation, primary-agent, AGENTS.md, or external skills.
  - `prompt` (chat mode):
    ```
    <parent-transcript-snapshot capturedAt="...">
    [user] ...
    [assistant] ...
    ...
    </parent-transcript-snapshot>

    <side-chat-question>
    ...userPrompt...
    </side-chat-question>
    ```
  - `prompt` (tangent mode):
    ```
    <side-chat-question>
    ...userPrompt...
    </side-chat-question>
    ```
- **Dependencies:** Task 1.
- **Guardrails:**
  - MUST NOT import `gremlin-prompt.ts`'s `buildGremlinPrompt` (different framing — keep side-chat prompt format separate from gremlin delegation framing).
  - MUST NOT mutate or re-export `gremlin-session-factory.ts` shapes; treat that file as read-only.
  - MUST NOT add per-side-chat model/thinking override knobs (D8 deferral).
  - MUST NOT register tools, even an empty allowlist that triggers default tool registration.
- **Validation hook:** Task 5 unit tests + `npm run typecheck`.

### Task 3 — Add `extensions/pi-gremlins/side-chat-command.ts`

- **What:** Module that registers `/gremlins:chat` and `/gremlins:tangent`, parses arguments, captures parent-transcript snapshot for chat mode, dispatches to the side-chat factory, drives the SDK session, and renders output inline through pi-gremlins' existing renderer surface (`pi.sendMessage` + `pi.registerMessageRenderer`).
- **Exports (named):**
  - `const SIDE_CHAT_CHAT_COMMAND = "gremlins:chat"`
  - `const SIDE_CHAT_TANGENT_COMMAND = "gremlins:tangent"`
  - `const SIDE_CHAT_MESSAGE_TYPE = "pi-gremlins:side-chat"`
  - `interface SideChatCommandDeps { createSideChatSession?: typeof createSideChatSession; capturedAtFactory?: () => string; }` (constructor-injected for tests)
  - `function registerSideChatCommands(pi: ExtensionAPI, deps?: SideChatCommandDeps): void` — called from `index.ts`.
  - `function captureParentTranscriptSnapshot(ctx: ExtensionCommandContext): ParentTranscriptSnapshot | undefined` (exported for test).
  - `function parseSideChatArgs(args: string): { ok: true; userPrompt: string } | { ok: false; usage: string }` (exported for test).
- **Behavior:**
  1. Parse `args`:
     - Trim whitespace. If empty, call `ctx.ui.notify(USAGE_TEXT, "info")` (or fallback `console.log` if `hasUI === false`) and return without starting a session. Do NOT throw.
     - Usage text:
       - `/gremlins:chat <prompt>` → `Usage: /gremlins:chat <prompt>` plus 1-line description.
       - `/gremlins:tangent <prompt>` → `Usage: /gremlins:tangent <prompt>` plus 1-line description.
  2. For chat mode only, call `captureParentTranscriptSnapshot(ctx)`:
     - `ctx.sessionManager.getBranch()` → filter `entry.type === "message"` → project to `{ role, text }` (stringify content arrays via `extractTextFromContent`-style helper local to this module).
     - If snapshot is empty (no parent turns yet), proceed with empty entries array; chat mode still works on a brand-new session, just without history.
  3. Build session via `buildSideChatSessionConfig({ mode, userPrompt, parentSnapshot, parentModel: ctx.model, ... })`.
  4. Create session via `createSideChatSession(...)`.
  5. Drive `session.prompt(plan.prompt)`. Subscribe to events using the same projection patterns as `gremlin-runner.ts` *but inlined locally* — DO NOT import `gremlin-runner.ts` (it owns gremlin tool-call activity, which side-chat does not need; importing would couple two surfaces).
  6. As the assistant streams text, call `pi.sendMessage({ customType: SIDE_CHAT_MESSAGE_TYPE, content: <text>, display: true, details: { mode, capturedAt } })`. This places the side-chat turn inline through the standard renderer (ADR-0004 D1).
  7. On completion / abort / error, dispose the session and emit a final inline marker via `pi.sendMessage`.
  8. Honor `ctx.signal` for abort.
- **Inline rendering & visual delimiter (PRD UX, ADR-0004 D1):**
  - Register a custom message renderer in `index.ts` for `SIDE_CHAT_MESSAGE_TYPE` that prefixes each side-chat turn with a clear, fixed label:
    - Chat mode: `💬 side-chat (chat)` on the first line, then the assistant text.
    - Tangent mode: `🧭 side-chat (tangent)` on the first line, then the assistant text.
    - Both end with a footer line: `└─ side-chat ended ─` after the final chunk.
  - Exact prefix/label strings are exported as `SIDE_CHAT_CHAT_LABEL` and `SIDE_CHAT_TANGENT_LABEL` constants so tests can assert them. Use Unicode `└─` for the closer (matches existing pi-tui idioms; if pi-tui exposes a helper, prefer that — implementer to confirm at Task 1 evidence pass).
- **Dependencies:** Task 2.
- **Guardrails:**
  - MUST NOT introduce overlay/popup viewer (ADR-0004 D1, AGENTS.md anti-pattern).
  - MUST NOT persist side-chat output to a custom session entry type (ADR-0004 D2, D8). Use `pi.sendMessage` (ephemeral inline rendering only); do NOT call `pi.appendEntry`.
  - MUST NOT capture parent transcript for `/gremlins:tangent`.
  - MUST NOT pass parent transcript through `systemPrompt` or as a tool — input only (ADR-0004 D3).
  - MUST NOT register tools on the SDK session (ADR-0004 D4).
  - MUST NOT call into `primary-agent-prompt.ts` / `primary-agent-controls.ts` / `applyPrimaryAgentPromptInjection` (no primary-agent leakage; PRD-0003 isolation invariant).
  - MUST NOT shell out, spawn nested Pi CLI, or write a temp prompt file (ADR-0002 anti-patterns).
  - Empty arg path MUST exit before any session is created.
- **Validation hook:** Task 5 unit tests + `npm test`.

### Task 4 — Wire registration in `extensions/pi-gremlins/index.ts`

- **What:** Inside `createPiGremlinsExtension(options)` -> `registerPiGremlins(pi)`, after the existing `pi.registerCommand("gremlins:primary", ...)` and `pi.registerShortcut(PRIMARY_SHORTCUT, ...)` blocks (lines ~139–161), call:
  - `registerSideChatCommands(pi);`
  - `pi.registerMessageRenderer(SIDE_CHAT_MESSAGE_TYPE, sideChatMessageRenderer);` (renderer factory exported from `side-chat-command.ts` or a small `side-chat-rendering.ts` if size grows).
- **References:**
  - `extensions/pi-gremlins/index.ts` lines 95–164 (existing registration block) — the only edit window. Do not refactor surrounding code.
- **Acceptance:**
  - `index.ts` adds two new top-of-file imports: `registerSideChatCommands`, `SIDE_CHAT_MESSAGE_TYPE`, `sideChatMessageRenderer`.
  - No other file in `extensions/pi-gremlins/` is modified by Task 4.
  - `pi.registerTool` block at the bottom is untouched.
- **Guardrails:**
  - Do not move the existing `pi.registerCommand("gremlins:primary", ...)` block.
  - Do not change `BRAND_NAME`, `TOOL_NAME`, `TOOL_DESCRIPTION`, `PiGremlinsParams`, or anything related to the `pi-gremlins` tool.
  - Do not introduce a new branch of session-state plumbing (`primaryAgentState` flow stays intact).
- **Validation hook:** existing `extensions/pi-gremlins/index.execute.test.js` and `index.render.test.js` MUST continue to pass without modification (Task 5 enumerates them).

### Task 5 — Tests (Bun JS, beside modules)

All new tests live under `extensions/pi-gremlins/` and follow the existing
`bun:test` pattern in `gremlin-session-factory.test.js`.

#### 5a. New: `extensions/pi-gremlins/side-chat-session-factory.test.js`

Suite: `side-chat session factory v1 contract`. Each test imports the TS
source via dynamic `await import("./side-chat-session-factory.ts")`.

- **T1 — zero tools (chat mode):** assert `config.tools` is an empty array `[]`, not `undefined` and not non-empty.
- **T2 — zero tools (tangent mode):** same as T1 with `mode: "tangent"`.
- **T3 — isolation (resources empty):** `config.resources.extensions/skills/prompts/themes/agents` are all `[]`. Asserts ADR-0003 isolation primitive is reused.
- **T4 — isolation (resourceLoader getters):** call each getter (`getExtensions`, `getSkills`, `getPrompts`, `getThemes`, `getAgentsFiles`, `getAppendSystemPrompt`) and assert empty arrays or empty results. Asserts no parent ext/skills/themes/AGENTS leak.
- **T5 — system prompt isolation:** `config.systemPrompt` is one of the two fixed `SIDE_CHAT_SYSTEM_PROMPT_*` constants and contains NONE of: parent agent name, primary-agent markdown markers (`<!-- pi-gremlins primary agent:start -->`), `AGENTS.md`-derived strings, gremlin frontmatter literals, or arbitrary parent text. Implemented by passing a fake `parentSnapshot` containing a sentinel like `"PARENT_SENTINEL_BANNED"` and asserting `systemPrompt.includes("PARENT_SENTINEL_BANNED") === false`.
- **T6 — tangent mode passes no transcript:** with `mode: "tangent"` and a non-empty `parentSnapshot`, `config.prompt.includes("parent-transcript-snapshot") === false` and `config.prompt.includes(<sentinel>) === false`.
- **T7 — chat mode embeds the supplied snapshot only as input:** with `mode: "chat"` and entries `[{ role: "user", text: "X1" }, { role: "assistant", text: "X2" }]`, `config.prompt.includes("X1")` and `config.prompt.includes("X2")` are true; `config.systemPrompt.includes("X1") === false`; `config.tools` still `[]`; `config.resources.extensions === []`.
- **T8 — empty snapshot in chat mode is allowed:** with `parentSnapshot.entries === []`, `config.prompt` contains the `<side-chat-question>` block but the transcript block is omitted (or empty); no crash.
- **T9 — model/thinking inheritance:** parent model `"openai/gpt-5"` is propagated as `config.model`; parent thinking `"medium"` is propagated as `config.thinking`. Asserts D8 (no per-side-chat overrides) by passing fake gremlin-frontmatter-shaped overrides (which the side-chat factory does NOT expose) and confirming they cannot be supplied.

#### 5b. New: `extensions/pi-gremlins/side-chat-command.test.js`

Suite: `side-chat command v1 contract`.

- **T1 — empty arg prints usage (chat):** stub `pi.registerCommand` to capture handlers, invoke chat handler with `args = ""`, assert `ctx.ui.notify` was called with text matching `/Usage: \/gremlins:chat/`, and assert `createSideChatSession` was NOT invoked.
- **T2 — empty arg prints usage (tangent):** mirror of T1 for tangent.
- **T3 — whitespace-only arg treated as empty:** `args = "   \t  "` → usage path.
- **T4 — chat handler captures parent transcript:** stub `ctx.sessionManager.getBranch` to return two `SessionMessageEntry`-shaped objects; assert the snapshot passed to a stubbed `createSideChatSession` has matching `entries` and a non-empty `capturedAt`.
- **T5 — tangent handler does NOT capture parent transcript:** assert `parentSnapshot` is `undefined` (or absent) on the call to `createSideChatSession`.
- **T6 — consecutive invocations are independent (no in-memory state leak):** invoke chat handler twice with different prompts; each call constructs a fresh session config (assert `createSideChatSession` called twice with distinct `userPrompt` arguments), and the second call's `parentSnapshot` reflects the second `getBranch()` reading rather than the first (mutate the stub between calls).
- **T7 — tangent and chat invocations do not share state:** invoke chat then tangent; assert tangent's call args do NOT include any sentinel from chat's `parentSnapshot`.
- **T8 — abort propagation:** stub `ctx.signal` with an `AbortController().signal` and assert it is forwarded to the session driver. (Optional if signal forwarding is straightforward; keep test if reasonable, drop if it requires excessive scaffolding.)
- **T9 — inline rendering uses `pi.sendMessage` with `SIDE_CHAT_MESSAGE_TYPE`:** stub `pi.sendMessage` to capture calls; drive a fake session that emits one assistant text chunk; assert `pi.sendMessage` was called with `customType === "pi-gremlins:side-chat"`, `display === true`, and content containing the chunk text.
- **T10 — visual delimiter constants exported:** `SIDE_CHAT_CHAT_LABEL` and `SIDE_CHAT_TANGENT_LABEL` are non-empty strings and differ.

#### 5c. Existing tests — must remain green and untouched

These files run today via `bun test extensions/pi-gremlins/*.test.js`
(`package.json` `scripts.test`) and MUST NOT be edited:

- `extensions/pi-gremlins/gremlin-discovery.test.js`
- `extensions/pi-gremlins/gremlin-rendering.test.js`
- `extensions/pi-gremlins/gremlin-runner.test.js`
- `extensions/pi-gremlins/gremlin-scheduler.test.js`
- `extensions/pi-gremlins/gremlin-schema.test.js`
- `extensions/pi-gremlins/gremlin-session-factory.test.js`
- `extensions/pi-gremlins/index.execute.test.js`
- `extensions/pi-gremlins/index.render.test.js`
- `extensions/pi-gremlins/primary-agent.test.js`

If any of these starts failing after the side-chat additions, the change is
out of contract — fix the side-chat module, not the existing test.

### Task 6 — README.md update

- **What:** Add a `## Side-chat: /gremlins:chat and /gremlins:tangent` section.
- **Where:** insert after the `## Use` section, before any later sections (read README first to confirm exact insertion point — implementer must `read README.md` end-to-end before editing).
- **Required content:**
  - One-paragraph overview: side-chat absorbed from pi-gizmo; two commands; built on the same in-process SDK runtime.
  - Subsection `### Commands`:
    - `/gremlins:chat <prompt>` — seeds with a snapshot of the parent transcript at invocation time; inline output.
    - `/gremlins:tangent <prompt>` — clean child session, no parent context; inline output.
    - Empty argument prints usage; does not start a session.
  - Subsection `### v1 guarantees`:
    - Fresh side-thread per invocation (Q1).
    - Inline rendering only — no overlay/popup (Q2; ADR-0004 D1).
    - Zero tools — pure conversation surface; cannot read or modify the workspace (Q4; ADR-0004 D4).
    - Built on `gremlin-session-factory` primitives; same isolation as gremlin delegation (ADR-0003, ADR-0004 D3, D5).
    - Copy/paste is the supported handoff mechanism in v1 (Q3).
  - Subsection `### Visual delimiter`: documents the exact `💬 side-chat (chat)` / `🧭 side-chat (tangent)` headers and `└─ side-chat ended ─` footer.
  - Subsection `### Migration from pi-gizmo` with the **1:N migration table**:

    | Retired pi-gizmo command | pi-gremlins replacement | Notes |
    | --- | --- | --- |
    | `gizmo` (chat send) | `/gremlins:chat <prompt>` | Parent-context attached, fresh per invocation. |
    | `gizmo:tangent` | `/gremlins:tangent <prompt>` | Clean child session. |
    | `gizmo:new` | (none — structurally unnecessary) | Fresh-per-invocation makes explicit "new" redundant. |
    | `gizmo:recap` | (deferred) | No v1 replacement; revisit via future PRD. |
    | `gizmo:clear` | (none — structurally unnecessary) | Fresh-per-invocation makes "clear" redundant. |
    | `gizmo:inject` | (deferred) | Use copy/paste in v1; revisit via future PRD. |
    | `gizmo:summarize` | (deferred) | No v1 replacement. |
    | `gizmo:model` | (deferred) | No per-side-chat model override in v1. |
    | `gizmo:thinking` | (deferred) | No per-side-chat thinking override in v1. |

  - One sentence reference: "See [PRD-0004](docs/prd/0004-pi-gremlins-side-chat-absorption-and-pi-gizmo-deprecation.md) and [ADR-0004](docs/adr/0004-side-chat-absorption-from-pi-gizmo.md)."
  - Note: do NOT run `pi-gizmo` and `pi-gremlins` side-chat commands concurrently if installed simultaneously (mirrors the PRD risk note).
- **Guardrails:** preserve existing README sections verbatim outside the inserted block.
- **Validation hook:** `head -200 README.md` after edit; manual visual review.

### Task 7 — CHANGELOG.md update

- **What:** Under the existing `## [Unreleased]` block, add a new bullet to the most appropriate subsection (`### Added` if present, else create one above `### Changed`):
  - `**Side-chat absorbed from pi-gizmo** (PRD-0004, ADR-0004, issue #47): pi-gremlins now ships /gremlins:chat (parent-transcript snapshot) and /gremlins:tangent (clean child session), rebuilt on the existing in-process SDK runtime with zero tools and inline rendering. See README "Side-chat" section for the pi-gizmo migration table.`
- **Guardrails:** do not reorder or rewrite existing `## [Unreleased]` bullets.
- **Validation hook:** `head -40 CHANGELOG.md` after edit.

### Task 8 — Self-review pass before marking the PR ready

- Re-read `side-chat-session-factory.ts` and `side-chat-command.ts` end-to-end and check each PRD-0004 acceptance criterion and each ADR-0004 D1–D8 commitment against the diff. Cross out only those visible in the code.
- Re-run `npm run check` (typecheck + bun test).
- Confirm the README and CHANGELOG edits cite PRD-0004 and ADR-0004 and that the migration table covers all nine retired pi-gizmo commands listed in PRD-0004 acceptance ("`gizmo:new`, `gizmo:recap`, `gizmo:inject`, `gizmo:summarize`, `gizmo:model`, `gizmo:thinking`, `gizmo:clear`, plus chat send/list verbs").

## Test Matrix (acceptance criterion → test)

| Acceptance criterion (source) | Test file → test name |
| --- | --- |
| `/gremlins:chat` registered (PRD §AC) | `side-chat-command.test.js` → T9 (registration captured) + Task 4 review |
| `/gremlins:tangent` registered (PRD §AC) | `side-chat-command.test.js` → T9 (registration captured) + Task 4 review |
| No new commands beyond chat/tangent (PRD §AC) | Task 4 review (only two `pi.registerCommand` additions) |
| Implementation under `extensions/pi-gremlins/` reusing factory (PRD §AC; ADR-0004 D5) | `side-chat-session-factory.test.js` → T3, T4 |
| No `pi-gizmo` source ported (PRD §AC; ADR-0004 D5) | Task 4 review (no new dep added in `package.json`) |
| Fresh per-invocation chat (Q1) | `side-chat-command.test.js` → T6 |
| Fresh per-invocation tangent (Q1) | `side-chat-command.test.js` → T6, T7 |
| No custom session entry type for persistence (Q1; D2) | Task 3 guardrail (no `pi.appendEntry` call); review |
| Inline rendering only (Q2; D1) | `side-chat-command.test.js` → T9 (uses `pi.sendMessage` not overlay) |
| No inject/handoff command (Q3) | Task 4 review (only chat + tangent registered) |
| Zero tools in side-thread (Q4; D4) | `side-chat-session-factory.test.js` → T1, T2 |
| Chat attaches parent context only as input (Q4; D3) | `side-chat-session-factory.test.js` → T5, T7 |
| Tangent has no parent context (D3) | `side-chat-session-factory.test.js` → T6 |
| Built on existing factory; no nested CLI/popup/temp file (Q5; ADR-0002) | `side-chat-session-factory.test.js` → T3, T4; Task 3 guardrail |
| Empty arg prints usage instead of starting session (PRD UX; ADR-0004 D6) | `side-chat-command.test.js` → T1, T2, T3 |
| Visual delimiter present and unambiguous (PRD UX; ADR-0004 D1) | `side-chat-command.test.js` → T10 |
| README documents commands, fresh-per-invocation, inline-only, no-tools (PRD AC) | Task 6 review |
| README contains 1:N pi-gizmo migration table (PRD AC) | Task 6 review |
| CHANGELOG cites PRD-0004 and issue #47 (PRD AC; ADR-0004 verification) | Task 7 review |
| ADR-0003 isolation invariant preserved (no parent ext/skills/themes/AGENTS/primary-agent leak) | `side-chat-session-factory.test.js` → T3, T4, T5 |

## Risks and Mitigations

- **R1 — `tools: []` does not actually disable tools in pi-coding-agent 0.69.** If pi treats `[]` as "default" rather than "explicit empty", side-chat would expose tools in violation of D4. **Mitigation:** Task 1 evidence pass confirms behavior against `agent-session.d.ts`; if `[]` doesn't work, pivot to passing an explicit allowlist filter that yields zero tool registrations and assert in T1/T2.
- **R2 — Parent-transcript shape changes across pi versions.** `SessionEntry` schema differs between session versions (`CURRENT_SESSION_VERSION = 3`). **Mitigation:** project to `{ role, text }` defensively; tolerate `entry.message?.role` and `entry.message?.content` being missing; cover via T4 stub variations.
- **R3 — Primary-agent prompt injection accidentally triggering on side-chat.** `before_agent_start` hook in `index.ts` injects primary-agent markdown. The side-chat session is a *separate* SDK session created via `createGremlinSession`, so the host extension's `before_agent_start` does not fire on it (Inferred from gremlin runner behavior, where gremlins also don't inherit the primary-agent prompt — this is exactly the ADR-0003 invariant). **Mitigation:** T5 sentinel test asserts no primary-agent markers leak into `systemPrompt` or `prompt`. If the test fails, a second guard inside the side-chat factory hard-strips the primary-agent block patterns from any inherited string before use.
- **R4 — Inline renderer collision with existing pi-gremlins tool render.** `pi-gremlins` already registers a tool renderer (`renderCall` / `renderResult`) for `pi-gremlins`. The side-chat path uses `pi.registerMessageRenderer(SIDE_CHAT_MESSAGE_TYPE, ...)`, a separate API. **Mitigation:** Task 4 confirms two distinct surfaces; existing `index.execute.test.js` / `index.render.test.js` continue green.
- **R5 — Regressing existing PRD-0002 / PRD-0003 surfaces.** **Mitigation:** Task 5c forbids edits to existing tests; Task 4 forbids edits to surrounding registration code; full `npm run check` before merge.
- **R6 — Argument parser eating prompts that contain quotes / newlines.** `args` arrives as the raw string after the command name. **Mitigation:** treat the entire trimmed `args` as a single free-form `userPrompt`; do not split or interpret quotes. Cover with a test that passes `args` containing both single and double quotes (extension to T1 / T4).
- **R7 — Cross-package conflict if a user has both `pi-gizmo` and `pi-gremlins` installed and both register `/gremlins:*` or `/gizmo:*`.** **Mitigation:** README migration section explicitly tells users to migrate before relying on the new commands. Out-of-band coordination handled in post-merge items below.
- **R8 — Forgetting to register the message renderer for `SIDE_CHAT_MESSAGE_TYPE`.** Inline messages would render with a default placeholder. **Mitigation:** Task 4 explicitly lists the renderer registration; T9 covers `sendMessage` call but a second smoke check during Task 8 self-review confirms `registerMessageRenderer` is wired.

## Post-Merge Items (cross-package coordination, NOT in this PR)

Owner: **magimetal**. Executed in the **`pi-gizmo` repo** *after* the side-chat
absorption PR merges in `pi-gremlins`. These satisfy PRD-0004 deprecation
deliverables and ADR-0004 D7. They are intentionally out of scope for issue
#47's PR; tracking them here is mandatory so the absorption is not considered
done until they ship.

1. **`pi-gizmo` README** — replace "What this does" with a deprecation banner pointing at `pi-gremlins`, `/gremlins:chat`, and `/gremlins:tangent`. Link the `pi-gremlins` README migration section. Reference PRD-0004 and ADR-0004 by anchor (use absolute GitHub URLs since cross-repo).
2. **`pi-gizmo` CHANGELOG** — `## [Unreleased]` deprecation entry: "Deprecated. Use `pi-gremlins` `/gremlins:chat` and `/gremlins:tangent`. See PRD-0004 / ADR-0004 in the `pi-gremlins` repo."
3. **`pi-gizmo` final release** — bump version, ship the deprecation README/CHANGELOG, tag the release.
4. **npm deprecation marker (out-of-band)** — run `npm deprecate <pi-gizmo-package-name>@"*" "Deprecated; use pi-gremlins. See https://github.com/magimetal/pi-gremlins"` once the final release is published. This step is npm-CLI-only and never touches either repo's source.
5. **Verification of post-merge coordination:** after step 4, `npm view <pi-gizmo-package-name>` should show the deprecation message, and the `pi-gizmo` README's first paragraph must reference `pi-gremlins`. Track completion in the issue #47 thread before closing.

These five items are NOT blockers for the issue-47 PR merge in `pi-gremlins`,
but issue #47 stays open until they are checked off.

## Verification Commands (sequence at end of implementation)

Run from the repo root after Tasks 2–7 are complete:

```bash
npm run typecheck
npm test
npm run check
```

Expected:

- `npm run typecheck` (`tsc --noEmit`) — passes; no new `as any`, `@ts-ignore`, or `@ts-expect-error` introduced (the existing one in `index.ts:217` for the TypeBox 1.x deep-instantiation issue stays).
- `npm test` (`bun test extensions/pi-gremlins/*.test.js`) — all existing suites still green; `side-chat-session-factory.test.js` and `side-chat-command.test.js` green.
- `npm run check` — equivalent to running typecheck then test in series; must pass.

If any verification step fails, fix the side-chat modules — do not modify
existing pi-gremlins runtime modules or existing tests to make the side-chat
work.

## Assumptions

- `pi.registerCommand(name, { description, handler })` is the registration
  symbol for slash commands in this Pi version (Observed in `index.ts:139`
  and `types.d.ts:800`).
- `ctx.sessionManager.getBranch()` returns parent-session entries usable as
  the chat-mode snapshot (Observed in `index.ts:110` + `types.d.ts:244`).
- `pi.sendMessage({ customType, content, display: true })` plus
  `pi.registerMessageRenderer(customType, ...)` is sufficient for inline
  rendering of side-chat assistant turns without needing a tool-row surface
  (Inferred from `types.d.ts:814–820`).
- `tools: []` on the SDK session config disables tools registration (Inferred;
  Task 1 evidence pass confirms before Task 2 ships).
- The `pi-gizmo` repo lives under the same `magimetal` GitHub org and is
  edited out-of-band; this repo never imports it.

## Open Questions / Unknowns

- **U1 — Exact tools-disable contract of `createAgentSession`.** Need
  Task 1 evidence pass to confirm whether `tools: []` vs `tools: undefined` vs
  omitting the field disables tools. Resolved before Task 2 begins.
- **U2 — Stable transcript projection.** Whether `SessionMessageEntry.message`
  always exposes `role` and `content` in the v0.69.0 surface, or whether
  some entries can be tool/result messages we should drop. Plan resolves this
  defensively (filter to `role in ("user", "assistant")` only) but
  implementer should confirm during Task 1.
- **U3 — Renderer hook ergonomics.** Whether `pi.registerMessageRenderer`
  expects a Component-returning function similar to `renderCall`/`renderResult`
  or a simpler text-returning shape. Resolved during Task 1 by reading
  `MessageRenderer<T>` in `types.d.ts`.
- **U4 — `pi-gizmo` package name on npm.** Needed for Step 4 of post-merge
  items. Confirm via `npm view` before running `npm deprecate`.
