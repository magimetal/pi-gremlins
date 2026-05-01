# Issue #57 Plan: Side-Chat Approved Skills and Tools

## Objective

Implement PRD-0007 / ADR-0007 so `/gremlins:chat` and `/gremlins:tangent` can remain conversational-only by default, or opt into an explicit fail-closed side-chat capability profile for approved read-only workspace tools and approved skill resources. Preserve ADR-0005 persistent overlay behavior.

## Current Evidence

- `extensions/pi-gremlins/side-chat-session-factory.ts` hard-codes `tools: []`, empty resources, isolated resource loader, and static "NO tools" prompt text.
- `extensions/pi-gremlins/side-chat-command.ts` builds side-chat configs in `submitSideChatPrompt()` and persists completed exchanges in `finalizeExchange()`.
- `extensions/pi-gremlins/gremlin-session-factory.ts` passes `plan.tools` directly to Pi SDK `createAgentSession()` and exposes reusable isolated resource-loader primitives.
- Pi SDK 0.69.0 exports read-only tool names: `read`, `grep`, `find`, `ls`; default active tools otherwise include mutating `bash`, `edit`, `write`.
- Pi SDK surfaces skills in the child system prompt only when the resolved tool list includes `read`; configured side-chat `skillPaths` without `read` must fail closed before child session creation.
- Pi SDK `loadSkills()` returns diagnostics for missing paths, non-markdown paths, invalid metadata, and name/metadata collisions instead of throwing; side-chat must treat diagnostics for configured paths as startup failure unless a test explicitly classifies a diagnostic as safe.
- Existing tests: `side-chat-session-factory.test.js`, `side-chat-command.test.js`, `side-chat-persistence.test.js`, `gremlin-session-factory.test.js`.

## Key Assumptions / Decisions for Implementation

- Configuration source: nearest project `.pi/settings.json`, matching existing primary-agent persistence locality. Public key: `pi-gremlins.sideChat`.
- Default absent/empty config remains conversational-only: `tools: []`, no skills, prompt says no tools/workspace access.
- Capability profile shape should be minimal and mode-aware:

```json
{
  "pi-gremlins": {
    "sideChat": {
      "chat": { "tools": ["read", "grep", "find", "ls"], "skillPaths": [".pi/skills/example/SKILL.md"] },
      "tangent": { "tools": [], "skillPaths": [] }
    }
  }
}
```

- Allowed tool universe for issue #57: `read`, `grep`, `find`, `ls` only. Reject `bash`, `edit`, `write`, unknown values, non-arrays, and ambiguous profile data.
- Approved skills use explicit side-chat `skillPaths`, resolved under the nearest project root and constrained to project-scoped `.pi/skills/` Markdown files. Reject absolute paths, parent traversal, paths outside `.pi/skills/`, non-markdown files, missing files, and ambiguous/colliding skill metadata.
- Non-empty `skillPaths` are valid only when the resolved mode profile includes `read`. If `skillPaths.length > 0` and `read` is absent, throw `SideChatCapabilityError` before creating the child session because Pi SDK will not surface skills without `read`.
- Skill loading is fail-closed: preflight the configured skill paths with `loadSkills({ includeDefaults: false })`; if any diagnostic is returned for a configured side-chat path, throw `SideChatCapabilityError` before `createAgentSession()` unless a dedicated test documents and permits a specific safe diagnostic class.
- Approved side-chat skills are not inherited from parent settings/resources, defaults, prompts, themes, AGENTS files, or primary-agent selected markdown.
- PRD-0007, ADR-0007, and ADR-0005 are implementation references only for this issue plan. Do not edit their lifecycle status or content unless a separate documentation-governance task explicitly requests that status update.
- Any invalid requested tool or skill path fails closed before creating the child session and reports a clear side-chat startup error.

## Phase 1 — Add Failing Contract Tests

### Task 1.1: Dedicated capability resolver tests

- **What:** Add mandatory focused tests for side-chat capability profile parsing, mode isolation, tool allowlisting, skill-path safety, `read` gating, and `loadSkills()` diagnostic fail-closed behavior.
- **References:**
  - New `extensions/pi-gremlins/side-chat-capabilities.test.js`
  - New `extensions/pi-gremlins/side-chat-capabilities.ts`
  - `extensions/pi-gremlins/primary-agent-persistence.ts` for nearest `.pi/settings.json` pattern
  - `docs/prd/0007-allow-side-chat-sessions-to-use-approved-skills-and-tools.md` (reference only)
  - `docs/adr/0007-guarded-side-chat-tool-capabilities.md` (reference only)
- **Acceptance criteria:**
  - Missing config and empty mode profile resolve to `{ tools: [], skillPaths: [], skills: [] }` or the final equivalent resolved shape.
  - Chat and tangent profiles are resolved independently; a configured chat profile does not affect tangent, and a configured tangent profile does not affect chat.
  - `tools` is always resolved to an explicit array, including `[]`; no side-chat path can leave tools `undefined` or omitted.
  - Only `read`, `grep`, `find`, and `ls` are accepted; `bash`, `edit`, `write`, unknown tools, non-string entries, and non-array `tools` fail with `SideChatCapabilityError`.
  - Non-empty `skillPaths` with no resolved `read` tool fails with `SideChatCapabilityError` before any child session factory/create-agent path is called.
  - Skill paths are accepted only when project-relative, under `.pi/skills/`, markdown, existing, and free of unsafe traversal/symlink escape according to the implemented path checks.
  - Missing path, non-markdown path, invalid skill metadata, and collision diagnostics returned by `loadSkills()` all fail with `SideChatCapabilityError` before session creation.
  - Tests explicitly document any `loadSkills()` diagnostic class considered safe; absent such tests, all diagnostics for configured side-chat paths are fatal.
- **Guardrails:**
  - Do not change production code before adding these tests.
  - Do not make this test file optional or replace it with scattered coverage; keep a dedicated capability contract test file.
  - Do not use `as any`, `@ts-ignore`, or `@ts-expect-error` to bypass types.
- **Verification:**
  - `bun test extensions/pi-gremlins/side-chat-capabilities.test.js` should fail before implementation for the new expectations.

### Task 1.2: Session factory capability tests

- **What:** Add tests proving default disabled behavior, enabled read-only tool behavior, prompt capability text, preloaded approved skill resources, diagnostic fail-closed behavior, and allowlist rejection.
- **References:**
  - `extensions/pi-gremlins/side-chat-session-factory.test.js`
  - `extensions/pi-gremlins/side-chat-session-factory.ts`
  - New `extensions/pi-gremlins/side-chat-capabilities.ts`
  - `docs/prd/0007-allow-side-chat-sessions-to-use-approved-skills-and-tools.md` (reference only)
  - `docs/adr/0007-guarded-side-chat-tool-capabilities.md` (reference only)
- **Acceptance criteria:**
  - Default chat/tangent configs still produce explicit `tools: []` and no skills.
  - Enabled profile with `tools: ["read", "grep", "find", "ls"]` produces exactly those tools.
  - Every built side-chat session config passes an explicit `tools` array to `createGremlinSession()` / Pi SDK, including the disabled case.
  - Prompt text for enabled chat/tangent says workspace read/search/list inspection is available and no mutation/shell tools are available.
  - Prompt text for disabled chat/tangent still says no tools/workspace access.
  - Disallowed tools (`bash`, `edit`, `write`, unknown) throw a clear fail-closed error and do not produce a session config.
  - Non-empty `skillPaths` without `read` throws a clear fail-closed error and does not call `createAgentSession()`.
  - Missing skill path, non-markdown skill path, invalid metadata, or skill collision diagnostics from `loadSkills()` throw `SideChatCapabilityError` and do not call `createAgentSession()`.
  - Skill loader returns only explicitly configured side-chat skills; parent extensions/prompts/themes/AGENTS remain empty.
- **Guardrails:**
  - Do not weaken ADR-0003 isolation assertions already in T3/T4/T5/T7.
  - Do not allow resource loading to occur after `createAgentSession()` for invalid configured skills; startup must fail before child session creation.
  - Do not use `as any`, `@ts-ignore`, or `@ts-expect-error` to bypass types.
- **Verification:**
  - `bun test extensions/pi-gremlins/side-chat-session-factory.test.js` should fail before implementation for the new expectations.

### Task 1.3: Command/persistence regression tests

- **What:** Add tests proving command path resolves a mode-specific capability profile, rejects invalid profile startup, and persists completed tool-backed responses like normal responses.
- **References:**
  - `extensions/pi-gremlins/side-chat-command.test.js`
  - `extensions/pi-gremlins/side-chat-command.ts`
  - `extensions/pi-gremlins/side-chat-persistence.test.js`
  - `extensions/pi-gremlins/side-chat-persistence.ts`
  - New `extensions/pi-gremlins/side-chat-capabilities.ts`
- **Acceptance criteria:**
  - `/gremlins:chat <prompt>` passes a chat profile into `buildSideChatSessionConfig()` / `createSideChatSession()`.
  - `/gremlins:tangent <prompt>` passes a tangent profile and never includes parent transcript context.
  - A chat-only configured profile does not affect `/gremlins:tangent`; tangent remains explicit `tools: []` unless tangent has its own profile.
  - Invalid configured tool or skill profile surfaces `Side-chat failed to start: ...` and appends no thread entry.
  - Invalid configured `skillPaths` without `read`, unsafe path, or fatal `loadSkills()` diagnostic prevents child session creation and appends no thread entry.
  - A fake assistant response that includes tool-call/tool-result-like transcript events still finalizes one `pi-gremlins:side-chat-thread` custom entry with question/answer/capturedAt semantics unchanged.
  - Context hook still removes side-chat custom entries from parent LLM context.
- **Guardrails:**
  - Keep overlay UI behavior out of scope except render requests already covered.
  - Do not persist capability profiles inside thread custom entries unless required by a testable safety reason.
- **Verification:**
  - `bun test extensions/pi-gremlins/side-chat-command.test.js extensions/pi-gremlins/side-chat-persistence.test.js` should fail before implementation for new capability expectations only.

## Phase 2 — Implement Capability Profile Resolution

### Task 2.1: Create a side-chat capability module

- **What:** Add a small module for reading, validating, resolving, and preflighting side-chat capability profiles from nearest `.pi/settings.json`.
- **References:**
  - New `extensions/pi-gremlins/side-chat-capabilities.ts`
  - New `extensions/pi-gremlins/side-chat-capabilities.test.js`
  - `extensions/pi-gremlins/primary-agent-persistence.ts` for nearest `.pi/settings.json` pattern
  - `node_modules/@mariozechner/pi-coding-agent/dist/core/tools/index.d.ts` for read-only tool names
  - Pi SDK `loadSkills()` type/runtime exports
- **Acceptance criteria:**
  - Exports types such as `SideChatCapabilityProfile`, `ResolvedSideChatCapabilities`, and `SideChatCapabilityError`.
  - Exports `readSideChatCapabilities(cwd, mode)` or equivalent; missing config resolves to an explicit disabled profile with `tools: []`, `skillPaths: []`, and no loaded skills.
  - Resolves `chat` and `tangent` separately; no fallback from one mode to the other unless that behavior is explicitly tested and documented.
  - Permits only `read`, `grep`, `find`, `ls`.
  - Rejects mutation/shell tools and unknown/non-string/non-array values with clear error messages.
  - Requires `read` whenever configured `skillPaths` is non-empty; missing `read` fails with `SideChatCapabilityError` before child session creation.
  - Resolves `skillPaths` deterministically under the nearest project root `.pi/skills/` boundary and rejects absolute paths, parent traversal, non-markdown paths, missing paths, symlink escapes, and paths outside `.pi/skills/` before session creation.
  - Calls `loadSkills({ includeDefaults: false })` only for explicit configured side-chat skill paths and treats every returned diagnostic as fatal unless a dedicated test marks a diagnostic safe.
  - Returns preloaded approved skills, or a final equivalent object, so the session factory does not need to discover parent/default resources.
  - Does not write settings; implementation is read-only for issue #57.
- **Guardrails:**
  - Do not import parent session resources or use parent settings skill defaults.
  - Do not enable read-only tools by default.
  - Do not add UI for editing settings.
  - Do not broaden the safe skill path boundary beyond project `.pi/skills/` without adding repo-specific evidence and tests.
- **Verification:**
  - `bun test extensions/pi-gremlins/side-chat-capabilities.test.js`

### Task 2.2: Wire command path to resolved capabilities

- **What:** Resolve the active mode's capabilities at side-chat session creation time and pass them into the session factory.
- **References:**
  - `extensions/pi-gremlins/side-chat-command.ts` (`submitSideChatPrompt()`)
  - `extensions/pi-gremlins/side-chat-session-factory.ts` (`BuildSideChatSessionConfigOptions`, `CreateSideChatSessionOptions`)
  - New `extensions/pi-gremlins/side-chat-capabilities.ts`
- **Acceptance criteria:**
  - Each new active child session uses capabilities resolved for its mode and current `ctx.cwd`.
  - Chat config does not affect tangent config, and tangent config does not affect chat config.
  - Resume/new overlay behavior is unchanged; capability is not recaptured into parent transcript.
  - Invalid capability profile prevents session creation, shows a clear error notification, and leaves persistence untouched.
  - Chat still captures parent snapshot only when chat thread has no exchanges; tangent still gets no snapshot.
- **Guardrails:**
  - Do not resolve capabilities on every prompt to an existing active session unless intentionally restarting the session; avoid mid-thread surprise escalation.
  - Do not alter command names or inline prompt compatibility.
- **Verification:**
  - `bun test extensions/pi-gremlins/side-chat-command.test.js`

## Phase 3 — Make Session Factory Capability-Aware

### Task 3.1: Dynamic prompt and explicit tool allowlist

- **What:** Replace static no-tool prompt selection with prompt construction from the resolved capability profile while preserving existing chat/tangent context rules.
- **References:**
  - `extensions/pi-gremlins/side-chat-session-factory.ts`
  - `extensions/pi-gremlins/gremlin-session-factory.ts`
  - New `extensions/pi-gremlins/side-chat-capabilities.ts`
- **Acceptance criteria:**
  - `SideChatSessionConfig.tools` becomes `string[]` and contains only resolved approved tool names.
  - Disabled profile returns `tools: []` exactly.
  - Side-chat never passes `undefined`, `null`, or an omitted tools property to Pi SDK; tests assert the explicit array for enabled and disabled profiles.
  - Enabled profile prompt accurately states allowed read-only capabilities and explicitly forbids mutation/shell/unlisted tools.
  - System prompt does not contain parent transcript or primary-agent prompt fragments.
  - `createSideChatSession()` continues routing through `createGremlinSession()` and passes `sessionConfig.tools` verbatim to Pi SDK.
- **Guardrails:**
  - Do not import or reuse `buildGremlinPrompt()`.
  - Do not expose per-side-chat model/thinking overrides.
  - Do not pass `undefined` tools for side-chat; use an explicit array to avoid Pi SDK default active tools.
- **Verification:**
  - `bun test extensions/pi-gremlins/side-chat-session-factory.test.js`

### Task 3.2: Approved skill resource loader

- **What:** Extend the isolated side-chat resource loader to return only preflight-approved side-chat skills while keeping all other resources empty.
- **References:**
  - `extensions/pi-gremlins/side-chat-session-factory.ts`
  - `extensions/pi-gremlins/gremlin-session-factory.ts` (`createIsolatedGremlinResourceLoader()`)
  - New `extensions/pi-gremlins/side-chat-capabilities.ts`
  - Pi SDK `loadSkills()` / `ResourceLoader.getSkills()` exports
- **Acceptance criteria:**
  - With no configured skill paths, `getSkills()` returns `{ skills: [], diagnostics: [] }`.
  - With configured skill paths, capability resolution has already loaded/validated them; `getSkills()` returns only those approved loaded skills and no fatal diagnostics.
  - If `loadSkills()` returns diagnostics for configured side-chat paths during preflight, `SideChatCapabilityError` is thrown before `createAgentSession()` and before the resource loader is handed to the child session.
  - `getExtensions()`, `getPrompts()`, `getThemes()`, `getAgentsFiles()`, and `getAppendSystemPrompt()` remain empty.
  - `getSystemPrompt()` returns the generated side-chat system prompt.
- **Guardrails:**
  - Do not use `DefaultResourceLoader` in a way that loads defaults, AGENTS files, prompts, themes, or extensions.
  - Do not load parent-selected primary-agent markdown or parent prompt material.
  - Do not silently drop `loadSkills()` diagnostics; fail closed unless tests classify a diagnostic as safe.
- **Verification:**
  - `bun test extensions/pi-gremlins/side-chat-session-factory.test.js`

## Phase 4 — Documentation and Release Notes

### Task 4.1: Update public README documentation

- **What:** Document the side-chat capability profile, default conversational-only behavior, read-only tool allowlist, approved skill path mechanism, and fail-closed behavior.
- **References:**
  - `README.md` (`Side-chat overlay` section)
  - `docs/prd/0007-allow-side-chat-sessions-to-use-approved-skills-and-tools.md` (reference only; do not edit for this implementation)
  - `docs/adr/0007-guarded-side-chat-tool-capabilities.md` (reference only; do not edit for this implementation)
  - `docs/adr/0005-persistent-overlay-side-chat.md` (reference only; do not edit for this implementation)
- **Acceptance criteria:**
  - README no longer states side-chat is always zero-tool; it states default is zero-tool and approved profiles may enable read-only tools/skills.
  - README includes a small `.pi/settings.json` example.
  - README states allowed tool names: `read`, `grep`, `find`, `ls`; explicitly not `bash`, `edit`, `write`.
  - README states non-empty `skillPaths` require `read`, are constrained to project `.pi/skills/` markdown files, and fail closed on unsafe paths or skill-loader diagnostics.
  - README links/cites PRD-0007 and ADR-0007 without changing their status or content.
- **Guardrails:**
  - Do not document unimplemented UI controls or defaults.
  - Do not modify PRD/ADR statuses or content in this implementation unless separately requested by a documentation-governance task.
- **Verification:**
  - Manual readback of README side-chat section.

### Task 4.2: Update changelog

- **What:** Add an unreleased/user-facing note for issue #57.
- **References:**
  - `CHANGELOG.md`
  - `docs/prd/0007-allow-side-chat-sessions-to-use-approved-skills-and-tools.md` (reference only)
  - `docs/adr/0007-guarded-side-chat-tool-capabilities.md` (reference only)
- **Acceptance criteria:**
  - Changelog mentions optional approved side-chat capabilities, default conversational-only behavior, fail-closed skill/tool validation, and PRD-0007/ADR-0007.
- **Guardrails:**
  - Do not claim release version/date unless project convention already has an unreleased section.
  - Do not edit PRD/ADR files as part of changelog work.
- **Verification:**
  - Manual readback of `CHANGELOG.md` entry.

## Phase 5 — Full Verification

### Task 5.1: Run targeted and full checks

- **What:** Run implementation verification after all code/docs changes.
- **References:**
  - `package.json`
  - `extensions/pi-gremlins/*.test.js`
  - `tsconfig.json`
- **Acceptance criteria:**
  - Targeted side-chat tests pass.
  - Full test suite passes.
  - Typecheck passes.
  - Combined check passes.
  - Verification output proves invalid tool profiles, invalid skill profiles, missing `read` for `skillPaths`, `loadSkills()` diagnostics, and explicit tools arrays are covered by tests.
- **Guardrails:**
  - If any verification fails, fix within issue scope or report exact blocker and failing output.
  - Do not hide type errors with `as any` / suppression comments.
- **Verification commands:**
  - `bun test extensions/pi-gremlins/side-chat-capabilities.test.js extensions/pi-gremlins/side-chat-session-factory.test.js extensions/pi-gremlins/side-chat-command.test.js extensions/pi-gremlins/side-chat-persistence.test.js`
  - `npm run typecheck`
  - `npm test`
  - `npm run check`

## Risk Register

- **Unknown exact user expectation for config location.** Mitigation: use existing project-local `.pi/settings.json` pattern and document it clearly.
- **Skill loading may expose more than metadata if the loader is too broad.** Mitigation: use explicit project-scoped `.pi/skills/` `skillPaths`, `includeDefaults: false`, preflight diagnostics as fatal, and keep all non-skill resource getters empty.
- **Skills silently unavailable without `read`.** Mitigation: reject non-empty `skillPaths` unless resolved tools includes `read`, because Pi SDK surfaces skills in the system prompt only when `read` is selected.
- **Pi SDK `loadSkills()` diagnostics are returned, not thrown.** Mitigation: assert diagnostics are inspected and converted to `SideChatCapabilityError` before child session creation.
- **Pi SDK default tools activate if `tools` is omitted.** Mitigation: side-chat config must always pass an explicit array, including `[]`, and tests must assert this.
- **Unsafe skill path boundary could leak local files.** Mitigation: default safe boundary is nearest project root `.pi/skills/`; reject absolute paths, traversal, symlink escape, and non-markdown paths unless repo evidence supports a narrower explicit exception.
- **Mid-thread config changes could surprise users.** Mitigation: resolve capabilities when creating a new child session; existing active session remains stable until reset/dispose.
- **README can overpromise tool behavior.** Mitigation: document only Pi SDK tool names observed in 0.69.0 and state mutation/shell tools are rejected.

## Implementation File Checklist

- Add: `extensions/pi-gremlins/side-chat-capabilities.ts`
- Add: `extensions/pi-gremlins/side-chat-capabilities.test.js` (mandatory dedicated capability resolver coverage)
- Modify: `extensions/pi-gremlins/side-chat-session-factory.ts`
- Modify: `extensions/pi-gremlins/side-chat-session-factory.test.js`
- Modify: `extensions/pi-gremlins/side-chat-command.ts`
- Modify: `extensions/pi-gremlins/side-chat-command.test.js`
- Modify if needed: `extensions/pi-gremlins/side-chat-persistence.test.js`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Reference only unless separately requested: `docs/prd/0007-allow-side-chat-sessions-to-use-approved-skills-and-tools.md`, `docs/adr/0007-guarded-side-chat-tool-capabilities.md`, `docs/adr/0005-persistent-overlay-side-chat.md`

## Definition of Done

- PRD-0007 acceptance criteria are mapped to tests or documentation.
- ADR-0007 fail-closed capability-profile boundary is implemented.
- Conversational-only side-chat remains possible and default.
- Approved read-only tools can be enabled without enabling mutation/shell tools.
- Side-chat always passes an explicit tools array to Pi SDK, including `[]` for disabled profiles.
- Non-empty approved skill paths require `read`; invalid `skillPaths` without `read` fail closed before child session creation.
- Approved skill paths are project-scoped to `.pi/skills/` markdown files and can be loaded without parent resource leakage.
- `loadSkills()` diagnostics for configured side-chat skill paths are converted into `SideChatCapabilityError` before `createAgentSession()` unless explicitly classified safe by tests.
- Chat and tangent mode profiles are independent; chat config does not affect tangent and tangent config does not affect chat.
- PRD/ADR files remain reference-only unless a separate lifecycle update is requested.
- ADR-0005 overlay persistence, reset markers, chat/tangent separation, and context filtering are preserved.
- Verification commands in Phase 5 pass or blockers are reported with exact output.
