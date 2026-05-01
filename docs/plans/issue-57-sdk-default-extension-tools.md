# Issue #57 Revised Plan: Side-Chat Uses SDK Defaults Plus Extension Custom Tools

## Objective

Replace the already-committed PRD-0007 / ADR-0007 configurable side-chat allowlist implementation with PRD-0008 / ADR-0008 behavior: `/gremlins:chat` and `/gremlins:tangent` create isolated child sessions that omit `tools` so Pi SDK default built-in tools apply, and expose enabled extension custom tools through a fresh child resource loader without side-chat-specific `.pi/settings.json` capability config.

## Current Evidence

- `docs/prd/0008-side-chat-sessions-use-sdk-default-tools-and-extension-custom-tools.md` is Active and supersedes PRD-0007. It requires SDK default tools (`read`, `bash`, `edit`, `write`), extension custom tools, no side-chat config, retained overlay persistence, and retained parent-context isolation.
- `docs/adr/0008-sdk-default-side-chat-tool-capabilities.md` is Accepted and supersedes ADR-0007. It requires omitting `tools` during child session creation and using a fresh side-chat child `DefaultResourceLoader` while stripping non-tool extension surfaces where possible.
- `extensions/pi-gremlins/side-chat-capabilities.ts` currently implements the superseded allowlist/settings model: reads nearest `.pi/settings.json`, validates `pi-gremlins.sideChat`, rejects `bash`/`edit`/`write`, and loads configured skills.
- `extensions/pi-gremlins/side-chat-session-factory.ts` currently imports `readSideChatCapabilities`, builds prompt text from `capabilities.tools`, returns required `tools: string[]`, and overrides `getSkills()` with allowlisted skills.
- `extensions/pi-gremlins/side-chat-command.ts` stores `activeCapabilities`, calls `readSideChatCapabilities(ctx.cwd, mode)`, and passes `capabilities` into the session factory.
- `extensions/pi-gremlins/gremlin-session-factory.ts` already passes `plan.tools` directly to `createAgentSession()`. If `plan.tools` is `undefined`, the SDK default tool policy is preserved; if `[]`, defaults are suppressed.
- `node_modules/@mariozechner/pi-coding-agent/dist/core/resource-loader.d.ts` shows `DefaultResourceLoader` supports `noPromptTemplates`, `noThemes`, `noSkills`, `noContextFiles`, `systemPrompt`, `extensionsOverride`, `skillsOverride`, `promptsOverride`, `themesOverride`, `agentsFilesOverride`, `systemPromptOverride`, `appendSystemPromptOverride`, and async `reload(): Promise<void>`.
- `node_modules/@mariozechner/pi-coding-agent/dist/index.d.ts` exports `DefaultResourceLoader`, `getAgentDir`, and `SettingsManager`, so implementation can import them from `@mariozechner/pi-coding-agent` unless local import conventions require a narrower path.
- `node_modules/@mariozechner/pi-coding-agent/dist/config.d.ts` defines `getAgentDir(): string`; `node_modules/@mariozechner/pi-coding-agent/dist/core/settings-manager.d.ts` defines `SettingsManager.create(cwd: string, agentDir?: string): SettingsManager`.
- SDK behavior constraint from review: `createAgentSession()` only reloads resource loaders it constructs itself. When side-chat passes a custom `resourceLoader`, code must call and await `sideChatResourceLoader.reload()` before passing that loader into `createGremlinSession()` / `createAgentSession()`.
- Extension tool constraint from review: custom tools require a non-empty `extensionsResult.extensions` with the minimum tool-bearing extension records/maps needed by `ExtensionRunner.getAllRegisteredTools()`. A plan or implementation that returns `extensions: []` while expecting extension tools to work is invalid.
- `README.md` still documents PRD-0007 default zero-tool/allowlist behavior and must be revised.
- Existing tests `side-chat-capabilities.test.js` and portions of `side-chat-session-factory.test.js` assert the superseded allowlist behavior and must be removed or rewritten.

## Key Assumptions

- **Observed:** `createAgentSession({ tools: plan.tools })` in `gremlin-session-factory.ts` can pass `undefined`; this is the required path for SDK defaults.
- **Observed:** `DefaultResourceLoaderOptions` includes override hooks that can zero out prompts, themes, skills, AGENTS/context files, system prompt append text, and potentially extension metadata while preserving the runtime needed for registered custom tools.
- **Inferred:** Enabled extension discovery should be delegated to `DefaultResourceLoader` using the same package/settings source as normal SDK sessions, not copied from the parent runtime.
- **Observed:** `LoadExtensionsResult.extensions` cannot be emptied if extension custom tools are expected; implementation must preserve non-empty tool-bearing extension records/maps needed by `ExtensionRunner.getAllRegisteredTools()`.
- **Inferred:** Non-tool extension surfaces should be stripped by resource loader overrides (`getPrompts`, `getThemes`, `getSkills`, AGENTS/context, system prompt append) and, where type-safe, by reducing extension records to the minimum fields that still retain registered tools. Tests must define the minimum preserved shape.
- **Unknown:** Whether package flag/filter settings must be mirrored exactly by a new `SettingsManager.create(cwd, agentDir)` or can safely reuse an injected settings manager from the command/session context. Make the choice test-backed: enabled packages/extensions from settings produce tools, disabled/filtered entries do not.

## Phase 1 — Replace Superseded Allowlist Contract Tests

### Task 1.1: Remove or rewrite capability resolver tests

- **What:** Delete `extensions/pi-gremlins/side-chat-capabilities.test.js` if no replacement capability module remains, or rewrite it to test only extension-tool resource loading helpers if they are factored into a new module.
- **References:**
  - `extensions/pi-gremlins/side-chat-capabilities.test.js`
  - `extensions/pi-gremlins/side-chat-capabilities.ts`
  - `docs/prd/0008-side-chat-sessions-use-sdk-default-tools-and-extension-custom-tools.md`
  - `docs/adr/0008-sdk-default-side-chat-tool-capabilities.md`
- **Acceptance criteria:**
  - No test expects `.pi/settings.json`, `pi-gremlins.sideChat`, mode profiles, `skillPaths`, read-only allowlists, or `SideChatCapabilityError`.
  - If a helper module remains, tests prove it does not read side-chat config and does not reject `bash`, `edit`, or `write`.
  - Tests assert SDK-default behavior indirectly by expecting `tools` to be omitted/`undefined`, not an explicit built-in list.
- **Guardrails:**
  - Do not preserve PRD-0007 tests under a renamed description.
  - Do not add side-chat-specific config aliases or migration behavior.
- **Verification:**
  - `bun test extensions/pi-gremlins/side-chat-capabilities.test.js` if the file remains; otherwise confirm `ls extensions/pi-gremlins/side-chat-capabilities.test.js` fails and no package script references it directly.

### Task 1.2: Rewrite session factory tests for SDK defaults and extension tools

- **What:** Update `side-chat-session-factory.test.js` to assert ADR-0008 session config semantics.
- **References:**
  - `extensions/pi-gremlins/side-chat-session-factory.test.js`
  - `extensions/pi-gremlins/side-chat-session-factory.ts`
  - `extensions/pi-gremlins/gremlin-session-factory.ts`
  - `node_modules/@mariozechner/pi-coding-agent/dist/core/resource-loader.d.ts`
  - `node_modules/@mariozechner/pi-coding-agent/dist/index.d.ts` (`DefaultResourceLoader`, `getAgentDir`, `SettingsManager` exports)
  - `node_modules/@mariozechner/pi-coding-agent/dist/config.d.ts` (`getAgentDir()`)
  - `node_modules/@mariozechner/pi-coding-agent/dist/core/settings-manager.d.ts` (`SettingsManager.create(cwd, agentDir?)`)
- **Acceptance criteria:**
  - Chat and tangent configs have `tools === undefined` or omit the `tools` own-property, matching the selected implementation type.
  - `createSideChatSession()` routes an omitted/undefined `tools` value through to `createGremlinSession()` / `createAgentSession()` without converting it to `[]`.
  - System prompts for both modes state that SDK default built-in tools may be available, including read/shell/edit/write capability wording, and do not say `NO tools`, `conversational-only`, or `approved read-only`.
  - Chat still embeds only the origin parent transcript snapshot in the user prompt; tangent still omits supplied parent snapshots.
  - System prompt and non-tool resource getters do not include parent transcript sentinels, primary-agent block sentinels, AGENTS content, prompts, themes, or skills.
  - A fake enabled extension custom tool is visible through the side-chat resource loader/runtime path using a fresh child `DefaultResourceLoader` path after `await loader.reload()`.
  - Tests prove `extensionsResult.extensions` is non-empty for tool-bearing extension fixtures and includes the minimum records/maps needed by `ExtensionRunner.getAllRegisteredTools()`; no test or implementation relies on `extensions: []` preserving custom tools.
  - Non-tool extension surfaces are stripped where possible: `getPrompts().prompts`, `getThemes().themes`, `getSkills().skills`, `getAgentsFiles().agentsFiles`, `getAppendSystemPrompt()`, and parent/system prompt overrides return empty or side-chat-only values.
- **Guardrails:**
  - Do not assert an explicit built-in tool array such as `["read", "bash", "edit", "write"]`; SDK owns defaults.
  - Do not weaken existing isolation assertions for chat/tangent prompts.
  - Do not use `as any`, `@ts-ignore`, or `@ts-expect-error` to bypass types.
- **Verification:**
  - `bun test extensions/pi-gremlins/side-chat-session-factory.test.js` should fail before implementation and pass after.

### Task 1.3: Rewrite command and persistence regression tests

- **What:** Update command-path tests so runtime no longer resolves/stores active allowlist capabilities and still persists tool-backed exchanges.
- **References:**
  - `extensions/pi-gremlins/side-chat-command.test.js`
  - `extensions/pi-gremlins/side-chat-command.ts`
  - `extensions/pi-gremlins/side-chat-persistence.test.js`
  - `extensions/pi-gremlins/side-chat-persistence.ts`
- **Acceptance criteria:**
  - `/gremlins:chat <prompt>` and `/gremlins:tangent <prompt>` create side-chat sessions without calling a side-chat settings/capability resolver.
  - Session creation options do not include `capabilities` and do not include `tools: []`.
  - A `.pi/settings.json` containing old `pi-gremlins.sideChat` data is ignored and cannot change side-chat session config.
  - Invalid old allowlist values such as `tools: ["unknown"]` or `skillPaths` do not fail side-chat startup because the config is no longer read.
  - Existing overlay semantics remain unchanged: resume, `:new`, chat-vs-tangent separation, branch restore, reset markers, context filtering, and completed-exchange persistence.
  - Fake transcript events representing tool-backed assistant output still finalize exactly one `pi-gremlins:side-chat-thread` custom entry with unchanged `question`, `answer`, `capturedAt`, and `parentSnapshot` semantics.
- **Guardrails:**
  - Do not persist tool names, extension names, capability config, or resource-loader internals in side-chat thread entries.
  - Keep overlay UI behavior changes out of scope unless required by broken tests.
- **Verification:**
  - `bun test extensions/pi-gremlins/side-chat-command.test.js extensions/pi-gremlins/side-chat-persistence.test.js`

## Phase 2 — Remove Allowlist Runtime and Make Tools Omitted

### Task 2.1: Remove the side-chat allowlist module from runtime

- **What:** Delete `side-chat-capabilities.ts` if no longer needed, or replace it with a narrowly named extension-tool resource helper that contains no `.pi/settings.json` logic.
- **References:**
  - `extensions/pi-gremlins/side-chat-capabilities.ts`
  - `extensions/pi-gremlins/side-chat-session-factory.ts`
  - `extensions/pi-gremlins/side-chat-command.ts`
- **Acceptance criteria:**
  - No production import references `readSideChatCapabilities`, `ResolvedSideChatCapabilities`, `SideChatCapabilityError`, `SIDE_CHAT_SETTINGS_NAMESPACE`, `SIDE_CHAT_SETTINGS_KEY`, `SIDE_CHAT_ALLOWED_TOOLS`, or `loadSkills` for side-chat allowlists.
  - No production code reads `.pi/settings.json` for `pi-gremlins.sideChat`.
  - No side-chat runtime code validates tool names or skill paths for issue #57 behavior.
- **Guardrails:**
  - Do not remove primary-agent settings behavior; only side-chat capability settings are obsolete.
  - Do not add migration warnings or startup failures for old config; PRD-0008 says no config is required or read.
- **Verification:**
  - `grep -R "readSideChatCapabilities\|ResolvedSideChatCapabilities\|SideChatCapabilityError\|pi-gremlins.*sideChat\|SIDE_CHAT_ALLOWED_TOOLS" -n extensions README.md CHANGELOG.md docs/plans/issue-57-sdk-default-extension-tools.md`
  - Expected: only this plan may mention obsolete symbols after code/docs updates; production/tests/README/CHANGELOG should not.

### Task 2.2: Change `SideChatSessionConfig.tools` to optional/omitted

- **What:** Update side-chat session config types/building so side-chat does not pass `tools: []` or any side-chat allowlist.
- **References:**
  - `extensions/pi-gremlins/side-chat-session-factory.ts` (`SideChatSessionConfig`, `buildSideChatSessionConfig()`, `createSideChatSession()`)
  - `extensions/pi-gremlins/gremlin-session-factory.ts` (`GremlinSessionConfig.tools?: string[]`, `createGremlinSession()`)
- **Acceptance criteria:**
  - `SideChatSessionConfig.tools` is optional (`tools?: string[]`) or removed from the side-chat-specific return shape while remaining assignable to `GremlinSessionConfig`.
  - `buildSideChatSessionConfig()` returns no `tools` property, or returns `tools: undefined`; tests pin the chosen representation.
  - `createSideChatSession()` passes the plan through without normalizing omitted tools to an empty array.
  - `gremlin-session-factory.ts` still supports explicit gremlin frontmatter tools for normal gremlin child sessions; only side-chat changes.
- **Guardrails:**
  - Do not hard-code `["read", "bash", "edit", "write"]`; omit `tools` so SDK defaults activate.
  - Do not change normal gremlin session semantics.
- **Verification:**
  - `bun test extensions/pi-gremlins/side-chat-session-factory.test.js extensions/pi-gremlins/gremlin-session-factory.test.js`

### Task 2.3: Remove active capability state from command runtime

- **What:** Simplify side-chat command runtime by removing mode-specific allowlist resolution and cached capabilities.
- **References:**
  - `extensions/pi-gremlins/side-chat-command.ts` (`SideChatRuntime.activeCapabilities`, `submitSideChatPrompt()`, `resetActiveSession()`)
  - `extensions/pi-gremlins/side-chat-command.test.js`
- **Acceptance criteria:**
  - `SideChatRuntime` no longer has `activeCapabilities`.
  - `submitSideChatPrompt()` creates a session/config without calling a side-chat settings resolver.
  - Existing active-session reuse still keys by mode and session existence; lack of `capabilities` does not cause unnecessary session recreation.
  - Error handling still catches child session creation failures and displays `Side-chat failed to start: ...`.
- **Guardrails:**
  - Do not alter command names, shortcut registration, inline prompt support, transcript snapshot timing, or reset behavior.
  - Do not resolve extension resources on every prompt to an already active side-chat session unless the child session is recreated.
- **Verification:**
  - `bun test extensions/pi-gremlins/side-chat-command.test.js`

## Phase 3 — Add Fresh Extension Custom Tool Loader With Non-Tool Filtering

### Task 3.0: Add SDK import/API references and dependency source

- **What:** Use the SDK exports needed for a fresh side-chat loader and settings source.
- **References:**
  - `extensions/pi-gremlins/side-chat-session-factory.ts`
  - `extensions/pi-gremlins/side-chat-command.ts`
  - `node_modules/@mariozechner/pi-coding-agent/dist/index.d.ts`
  - `node_modules/@mariozechner/pi-coding-agent/dist/config.d.ts`
  - `node_modules/@mariozechner/pi-coding-agent/dist/core/settings-manager.d.ts`
- **Acceptance criteria:**
  - Implementation imports `DefaultResourceLoader`, `getAgentDir`, and `SettingsManager` from `@mariozechner/pi-coding-agent` or documents an equivalent existing local import path.
  - If command/session context does not provide `agentDir`, default to `getAgentDir()` at side-chat session creation boundaries, not inside tests that need deterministic temp dirs.
  - If command/session context does not provide `settingsManager`, create one with `SettingsManager.create(cwd, agentDir)`; if context does provide one, reuse it only when tests prove it preserves the same package/extension enablement semantics.
  - Tests cover settings/flag behavior: enabled extension package/factory exposes its tool; disabled or filtered-out extension entries do not expose a tool. If exact package flags cannot be unit-tested without SDK internals, add a focused fixture around `DefaultResourceLoader` options and mark remaining integration behavior for manual/runtime verification.
- **Guardrails:**
  - Do not introduce side-chat-specific settings keys or flags.
  - Do not read old `pi-gremlins.sideChat` settings while sourcing SDK package/extension settings.
- **Verification:**
  - `bun test extensions/pi-gremlins/side-chat-session-factory.test.js extensions/pi-gremlins/side-chat-command.test.js`
  - Targeted assertions: extension tool is unavailable before the fake/fresh loader reload and available after the reload path; active-session reuse submits the second prompt without a second reload.

### Task 3.1: Build a side-chat resource loader around `DefaultResourceLoader`

- **What:** Replace `createSideChatResourceLoader()` with a fresh child `DefaultResourceLoader` that can discover enabled extension custom tools, preserve minimum tool-bearing extension records, and filter non-tool surfaces.
- **References:**
  - `extensions/pi-gremlins/side-chat-session-factory.ts` (`createSideChatResourceLoader()`)
  - `extensions/pi-gremlins/gremlin-session-factory.ts` (`createIsolatedGremlinResourceLoader()` as current zero-resource baseline)
  - `node_modules/@mariozechner/pi-coding-agent/dist/core/resource-loader.d.ts`
  - `node_modules/@mariozechner/pi-coding-agent/dist/index.d.ts` (`DefaultResourceLoader`, `getAgentDir`, `SettingsManager` exports)
  - `node_modules/@mariozechner/pi-coding-agent/dist/config.d.ts` (`getAgentDir()`)
  - `node_modules/@mariozechner/pi-coding-agent/dist/core/settings-manager.d.ts` (`SettingsManager.create(cwd, agentDir?)`)
- **Acceptance criteria:**
  - Side-chat uses a new `DefaultResourceLoader({ cwd, agentDir, settingsManager, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, systemPrompt, ...Override hooks })` instance or equivalent fresh child path, not parent runtime resources.
  - The implementation awaits `sideChatResourceLoader.reload()` before passing the custom loader to `createGremlinSession()` / `createAgentSession()`; this is mandatory because the SDK only reloads loaders it constructs itself.
  - The loader has side-chat `systemPrompt` and returns no append system prompt.
  - The loader disables or overrides non-tool resources: skills, prompts, themes, context/AGENTS files, and append-system-prompt material are empty.
  - Enabled extension custom tools remain available through the returned extension runtime/result after the explicit reload path.
  - `getExtensions().extensions` remains non-empty when a fixture extension registers tools, preserving the minimum records/maps needed by `ExtensionRunner.getAllRegisteredTools()`; do not set `extensions: []` for a tool-bearing result.
  - Strip non-tool surfaces where feasible, but preserve tool records needed for custom tools. If extension metadata fields must remain, document the minimum required shape in code comments and tests and assert no prompts/themes/skills/AGENTS/system-append material leaks through resource getters.
  - No parent transcript/history, primary-agent markdown, parent prompts, themes, skills, or AGENTS content can appear in side-chat system prompt, prompt, or resource getter outputs.
- **Guardrails:**
  - Do not pass parent `ResourceLoader` or parent `ExtensionRuntime` into side-chat.
  - Do not call `buildGremlinPrompt()` or `buildGremlinPrompt`-adjacent primary-agent prompt code.
  - Do not load default/user skills into side-chat merely because tools are available.
  - Do not pass an unreloaded custom `DefaultResourceLoader` into SDK session creation.
  - Do not use `extensions: []` as a filtering strategy for tool-bearing extension results.
- **Verification:**
  - `bun test extensions/pi-gremlins/side-chat-session-factory.test.js`

### Task 3.2: Thread needed loader dependencies and explicit reload through session creation

- **What:** Add only the dependencies needed for fresh `DefaultResourceLoader` construction and pre-session reload to side-chat config/session options.
- **References:**
  - `extensions/pi-gremlins/side-chat-session-factory.ts` (`BuildSideChatSessionConfigOptions`, `CreateSideChatSessionOptions`)
  - `extensions/pi-gremlins/side-chat-command.ts` (`ctx.cwd`, any available `ctx` services)
  - `extensions/pi-gremlins/gremlin-session-factory.ts` (`CreateGremlinSessionOptions.agentDir`, `settingsManager`, `sessionManager` patterns)
- **Acceptance criteria:**
  - Side-chat session config has enough information to construct a fresh loader rooted at the command cwd / agent dir.
  - `createSideChatSession()` or its loader factory awaits the fresh loader's `reload()` before calling `createGremlinSession()`; tests fail if reload is skipped or occurs after session creation.
  - Any added option is narrowly typed and passed from command context only if available.
  - Existing tests can inject fake loader factories or extension factories without touching global user config.
  - Reusing an already active side-chat session for another prompt in the same mode does not construct or reload a new loader; reload happens only for newly created child sessions.
  - Normal gremlin sessions remain isolated/no-extension unless separately configured by gremlin code.
- **Guardrails:**
  - Do not broaden public command API or add user-visible settings.
  - Do not require real installed third-party extensions in unit tests.
- **Verification:**
  - `bun test extensions/pi-gremlins/side-chat-session-factory.test.js extensions/pi-gremlins/side-chat-command.test.js`
  - Targeted assertions: extension tool is unavailable before the fake/fresh loader reload and available after the reload path; active-session reuse submits the second prompt without constructing or reloading another loader.

## Phase 4 — Prompt, Docs, and Release Notes

### Task 4.1: Update side-chat prompt text

- **What:** Replace allowlist/no-tool/read-only wording with ADR-0008 capability wording.
- **References:**
  - `extensions/pi-gremlins/side-chat-session-factory.ts` (`buildSideChatSystemPrompt()`, `SIDE_CHAT_SYSTEM_PROMPT_CHAT`, `SIDE_CHAT_SYSTEM_PROMPT_TANGENT`)
  - `extensions/pi-gremlins/side-chat-session-factory.test.js`
- **Acceptance criteria:**
  - Chat prompt says it receives only the parent transcript snapshot as conversational context and does not inherit live parent history.
  - Tangent prompt says it starts without parent transcript context.
  - Both prompts say SDK default built-in tools may be available and enabled extension custom tools may be available.
  - Neither prompt claims no workspace access, conversational-only behavior, read-only-only behavior, or absence of shell/edit/write tools.
  - Both prompts warn not to assume parent prompts/themes/AGENTS/primary-agent material/history are inherited.
- **Guardrails:**
  - Do not include parent transcript content in system prompt.
  - Do not overpromise exact SDK default tool names as a hard-coded runtime allowlist; wording may name current expected examples from PRD-0008 while making SDK ownership clear.
- **Verification:**
  - `bun test extensions/pi-gremlins/side-chat-session-factory.test.js`

### Task 4.2: Update README side-chat section

- **What:** Revise public documentation from PRD-0007 allowlist behavior to PRD-0008 SDK-default-plus-extension behavior.
- **References:**
  - `README.md` (`Side-chat overlay` section)
  - `docs/prd/0008-side-chat-sessions-use-sdk-default-tools-and-extension-custom-tools.md`
  - `docs/adr/0008-sdk-default-side-chat-tool-capabilities.md`
  - `docs/adr/0005-persistent-overlay-side-chat.md`
- **Acceptance criteria:**
  - README no longer documents optional approved capabilities, `.pi/settings.json`, `pi-gremlins.sideChat`, `skillPaths`, or a read-only allowlist.
  - README states side-chat omits explicit tools so SDK defaults apply, with expected built-in examples `read`, `bash`, `edit`, and `write` per PRD-0008.
  - README states enabled extension custom tools may be available through fresh extension loading.
  - README preserves persistence/isolation guarantees and clarifies no parent transcript/history/prompts/themes/AGENTS/primary-agent material are inherited except chat origin snapshot.
  - README links PRD-0008 / ADR-0008 and ADR-0005; PRD-0007 / ADR-0007 are not described as active behavior.
- **Guardrails:**
  - Do not edit PRD/ADR governance files in this implementation; they are already created/accepted per context.
  - Do not document UI controls for choosing tools.
- **Verification:**
  - Manual readback of README side-chat section.

### Task 4.3: Update CHANGELOG

- **What:** Replace or add issue #57 unreleased notes to describe the revised behavior.
- **References:**
  - `CHANGELOG.md`
  - `docs/prd/0008-side-chat-sessions-use-sdk-default-tools-and-extension-custom-tools.md`
  - `docs/adr/0008-sdk-default-side-chat-tool-capabilities.md`
- **Acceptance criteria:**
  - Changelog states side-chat now uses SDK default built-in tools plus enabled extension custom tools.
  - Changelog states side-chat-specific `.pi/settings.json` allowlists/configuration were removed/ignored.
  - Changelog states overlay persistence and chat/tangent isolation are retained.
- **Guardrails:**
  - Do not claim a release version/date unless the existing changelog convention has an unreleased section.
- **Verification:**
  - Manual readback of `CHANGELOG.md` entry.

## Phase 5 — Full Verification for Implementation Commit

### Task 5.1: Run targeted tests first

- **What:** Verify the revised behavior with focused tests.
- **References:**
  - `package.json`
  - `extensions/pi-gremlins/side-chat-session-factory.test.js`
  - `extensions/pi-gremlins/side-chat-command.test.js`
  - `extensions/pi-gremlins/side-chat-persistence.test.js`
  - `extensions/pi-gremlins/gremlin-session-factory.test.js`
- **Acceptance criteria:**
  - Targeted side-chat tests pass.
  - Gremlin session factory regression tests pass, proving normal gremlin tools behavior was not broken.
- **Guardrails:**
  - Do not skip failing tests or weaken assertions to match broken runtime behavior.
- **Verification:**
  - `bun test extensions/pi-gremlins/side-chat-session-factory.test.js extensions/pi-gremlins/side-chat-command.test.js extensions/pi-gremlins/side-chat-persistence.test.js extensions/pi-gremlins/gremlin-session-factory.test.js`

### Task 5.2: Run full repository checks

- **What:** Run final verification after implementation and documentation updates.
- **References:**
  - `package.json`
  - `tsconfig.json`
  - `extensions/pi-gremlins/*.test.js`
- **Acceptance criteria:**
  - Full test suite passes.
  - Typecheck passes.
  - No obsolete allowlist references remain in active runtime/docs.
- **Guardrails:**
  - Do not hide type errors with `as any`, `@ts-ignore`, or `@ts-expect-error`.
  - Do not commit generated artifacts or local secrets.
- **Verification:**
  - `npm test`
  - `npm run typecheck`
  - `npm run check`
  - `grep -R "pi-gremlins.sideChat\|skillPaths\|approved read-only\|conversational-only\|SideChatCapabilityError\|SIDE_CHAT_ALLOWED_TOOLS" -n extensions README.md CHANGELOG.md docs/prd docs/adr`
  - Expected grep result: only superseded PRD-0007/ADR-0007 historical documents and this plan may mention obsolete terms; active runtime, tests, README, CHANGELOG, PRD-0008, and ADR-0008 should not present them as current behavior.

## Files Expected to Change

- Remove or rewrite: `extensions/pi-gremlins/side-chat-capabilities.ts`
- Remove or rewrite: `extensions/pi-gremlins/side-chat-capabilities.test.js`
- Update: `extensions/pi-gremlins/side-chat-session-factory.ts`
- Update: `extensions/pi-gremlins/side-chat-session-factory.test.js`
- Update: `extensions/pi-gremlins/side-chat-command.ts`
- Update: `extensions/pi-gremlins/side-chat-command.test.js`
- Possibly update: `extensions/pi-gremlins/gremlin-session-factory.ts` only if dependency threading for `DefaultResourceLoader` requires shared option plumbing; do not alter normal gremlin semantics.
- Possibly update: `extensions/pi-gremlins/gremlin-session-factory.test.js` only for regression coverage if shared plumbing changes.
- Verify/no behavior change expected: `extensions/pi-gremlins/side-chat-persistence.ts`
- Update tests as needed: `extensions/pi-gremlins/side-chat-persistence.test.js`, `extensions/pi-gremlins/side-chat-transcript-state.test.js` if tool-backed transcript events expose uncovered persistence behavior.
- Update docs: `README.md`, `CHANGELOG.md`

## Open Risks / Blockers

- **Observed:** Extension custom tools require non-empty `extensionsResult.extensions`; filtering to `extensions: []` is not viable. Preserve the minimum tool-bearing extension records/maps needed by `ExtensionRunner.getAllRegisteredTools()` and test that shape.
- **Observed:** A custom side-chat `DefaultResourceLoader` must be explicitly reloaded before it is passed to `createGremlinSession()` / `createAgentSession()`; SDK auto-reload does not cover externally constructed loaders.
- **Unknown:** Command context may not expose all services needed to mirror normal extension enabling state. If `agentDir`, `settingsManager`, or extension factories are unavailable, implementation must thread them from the same SDK context used by normal sessions or use `getAgentDir()` plus `SettingsManager.create(cwd, agentDir)` and prove package/extension enablement behavior with tests.
- **Inferred:** Omitting `tools` activates SDK defaults; tests can verify omission but not the SDK's live default built-in list without integration/runtime execution.
- **Observed:** Existing allowlist tests are numerous and stale; implementation must intentionally remove/rewrite them rather than patching around their old assumptions.

## Planning-Time Verification

- Re-read this plan file after writing.
- `git diff -- docs/plans/issue-57-sdk-default-extension-tools.md` (or `git diff --no-index /dev/null docs/plans/issue-57-sdk-default-extension-tools.md` if untracked).
