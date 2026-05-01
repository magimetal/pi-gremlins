# Plan: Issue #59 Side-Chat Skill Prompt Support

## Objective

Add skill prompt support to `/gremlins:chat` and `/gremlins:tangent` side-chat child sessions while preserving the PRD-0008 / ADR-0008 boundary: SDK default tools and enabled extension custom tools remain available, side-chat-specific `.pi/settings.json` capability configuration stays ignored, and parent transcript/history/system prompt/primary-agent material/prompts/themes/AGENTS/context stay isolated.

## Authority and Current Findings

- `docs/prd/0008-side-chat-sessions-use-sdk-default-tools-and-extension-custom-tools.md` and `docs/adr/0008-sdk-default-side-chat-tool-capabilities.md` are the active side-chat capability authority, but they currently describe skill context as stripped. Issue #59 changes that surface and requires updating these existing records rather than creating unrelated new PRD/ADR files.
- `extensions/pi-gremlins/side-chat-session-factory.ts` creates a fresh `DefaultResourceLoader` with `noSkills: true` and `skillsOverride: () => ({ skills: [], diagnostics: [] })`, then forces `systemPromptOverride` to the base side-chat prompt. This blocks fresh child skill guidance and hides skill diagnostics.
- `extensions/pi-gremlins/side-chat-session-factory.test.js` currently asserts `getSkills().skills` is empty and that prompts mention tools but not skill support.
- `extensions/pi-gremlins/side-chat-command.test.js` already verifies side-chat-specific settings are ignored and active side-chat sessions reuse the existing child session/resource loader.
- `README.md` and `CHANGELOG.md` describe side-chat as stripping skills; both need user-facing alignment if implementation changes.

## Non-Goals / Guardrails

- Do not revive side-chat-specific allowlists, per-mode capability profiles, `pi-gremlins.sideChat.skillPaths`, package reshaping, subprocess architecture, temp prompt files, or deprecated viewer/chain behavior.
- Do not reuse parent-loaded resources or parent session state for skills. Skills must come only through the side-chat child session's fresh resource-loading boundary.
- Do not leak parent transcript/history/system prompt/primary-agent markdown/prompts/themes/AGENTS/context into side-chat. `chat` keeps only the existing origin transcript snapshot; `tangent` stays clean.
- Do not remove SDK default built-in tools or enabled extension custom tools.
- Do not hide TypeScript errors with `as any`, `@ts-ignore`, or `@ts-expect-error`.
- Do not add dead exports. If any helper/export is added or changed, verify it has at least one import/use outside its defining file; otherwise keep it file-local or remove it.

## Implementation Tasks

### 1. Add failing session-factory tests for fresh child skill loading and diagnostics

**What**

Update `extensions/pi-gremlins/side-chat-session-factory.test.js` first so the current implementation fails for the issue #59 behavior. Use explicit issue #59 fixtures so the test proves skill guidance, resource boundaries, and diagnostics reach the side-chat runtime rather than merely proving `getSkills()` is non-empty.

**References**

- `extensions/pi-gremlins/side-chat-session-factory.test.js`
- `extensions/pi-gremlins/v1-contract-harness.js`
- `extensions/pi-gremlins/test-helpers.js`
- `extensions/pi-gremlins/side-chat-session-factory.ts`
- `extensions/pi-gremlins/test-fixtures/issue-59-skills/fresh-child-skill/SKILL.md` (create fixture with a unique child-skill sentinel, for example `ISSUE_59_FRESH_CHILD_SKILL_GUIDANCE`)
- `extensions/pi-gremlins/test-fixtures/issue-59-skills/diagnostic-missing-description/SKILL.md` (create fixture with a unique diagnostics sentinel, for example `ISSUE_59_SKILL_DIAGNOSTIC_SENTINEL`, and intentionally invalid/missing metadata that produces a loader diagnostic)

**Acceptance criteria**

- A test proves side-chat resource loading no longer forces `getSkills().skills` to `[]` when the fresh child loader has intended skills available from `extensions/pi-gremlins/test-fixtures/issue-59-skills/fresh-child-skill/SKILL.md`.
- A test proves skill diagnostics from `extensions/pi-gremlins/test-fixtures/issue-59-skills/diagnostic-missing-description/SKILL.md` are preserved/observable and are not replaced with an empty diagnostics array.
- Objective runtime assertions prove the fresh child skill sentinel reaches the side-chat child runtime through SDK-side skill guidance/session prompt/resource-loader output. The test must inspect the actual prompt/systemPrompt/resource-loader data passed to `createAgentSession` or otherwise consumed by the child session; `getSkills().skills.length > 0` alone is insufficient.
- Negative assertions prove parent/legacy skill sentinels are absent from all side-chat runtime surfaces under test: `prompt`, `systemPrompt`, and direct `resources` passed to `createAgentSession`.
- A test proves side-chat system prompt/capability text mentions fresh child skill guidance/resources accurately while still saying parent-loaded skills are not inherited.
- Existing assertions still prove `resources` passed directly to the child session remain empty for parent-resource isolation, and `tools` remains omitted.
- Tests explicitly distinguish allowed fresh child skills from forbidden parent skill/resource inheritance by using separate sentinels such as `ISSUE_59_FRESH_CHILD_SKILL_GUIDANCE`, `ISSUE_59_PARENT_SKILL_SHOULD_NOT_LEAK`, and `ISSUE_59_LEGACY_SIDE_CHAT_SKILL_PATH_SHOULD_NOT_LEAK`.

**Guardrails**

- Do not make tests depend on side-chat-specific `.pi/settings.json` skill paths except as a negative legacy-sentinel fixture proving those settings cannot inject skill behavior.
- Do not weaken existing tests that prove prompts/themes/AGENTS/append-system-prompt material are stripped.
- Do not assert exact SDK-generated skill prompt wording unless the repository controls that wording; assert unique fixture sentinel reachability and explicit non-leakage instead.
- Keep any new fixture helpers private to the test file unless another file imports them; no dead exports.

**Verification**

```bash
npm test -- extensions/pi-gremlins/side-chat-session-factory.test.js
```

Expected before fix: the new skill/diagnostic assertions fail because `noSkills: true` and `skillsOverride` suppress skills and diagnostics.

### 2. Implement skill support in the side-chat resource-loader boundary

**What**

Modify `extensions/pi-gremlins/side-chat-session-factory.ts` so the fresh side-chat `DefaultResourceLoader` can load intended child-session skills and skill diagnostics while still stripping non-skill non-tool parent surfaces.

Recommended shape:

- Remove `noSkills: true` and the empty `skillsOverride` from `createSideChatResourceLoader`.
- Preserve `noPromptTemplates: true`, `noThemes: true`, `noContextFiles: true`, `promptsOverride`, `themesOverride`, `agentsFilesOverride`, and `appendSystemPromptOverride` unless implementation evidence shows a safer SDK-supported equivalent.
- Revisit `systemPromptOverride`: if it prevents the SDK/resource loader from appending skill guidance, replace it with the smallest safe composition that keeps the side-chat base prompt and fresh child skill guidance while excluding parent append prompt material. Prefer the SDK/`DefaultResourceLoader` native skill prompt path over custom reimplementation.
- Keep `extensionFactories` and fresh-loader `reload()` behavior intact so enabled extension custom tools continue to survive.
- Update `SIDE_CHAT_SYSTEM_PROMPT_CHAT` / `SIDE_CHAT_SYSTEM_PROMPT_TANGENT` text to state that fresh child skills/skill guidance may be available, and that parent-loaded skills are not inherited.

**References**

- `extensions/pi-gremlins/side-chat-session-factory.ts`
- `extensions/pi-gremlins/gremlin-session-factory.ts` for child-session creation and omitted `tools`
- `docs/adr/0008-sdk-default-side-chat-tool-capabilities.md` for isolation constraints

**Acceptance criteria**

- `buildSideChatSessionConfig(...).resourceLoader.getSkills()` can return fresh child skills and diagnostics instead of always returning empty values.
- The fresh child skill guidance/resource signal is visible to the side-chat runtime path used by `createAgentSession`, not only to an isolated `getSkills()` call.
- `createSideChatSession(...)` still awaits `plan.resourceLoader.reload()` before `createGremlinSession(...)`.
- `createAgentSession(...)` still receives `tools: undefined`/omitted so SDK default tools remain active.
- `createAgentSession(...)` still receives direct `resources` as `{ agents: [], extensions: [], prompts: [], skills: [], themes: [] }` or the established empty equivalent; fresh child skills must flow through the child `resourceLoader`, not parent resource injection.
- Extension tool records still survive after reload.
- Parent prompts, themes, AGENTS/context files, append-system-prompt material, primary-agent material, hidden parent context, parent-loaded skills, and legacy side-chat `.pi/settings.json` skill paths remain excluded.
- Any added or changed exported helper has a verified external import/use; otherwise it remains unexported.

**Guardrails**

- Do not add a custom side-chat skill resolver or new configuration file contract.
- Do not pass parent `resources` into `createAgentSession`.
- Do not load prompt templates, themes, or AGENTS/context files as a side effect of enabling skills.
- Do not use broad casts or dead exports to work around SDK typing or test access.

**Verification**

```bash
npm test -- extensions/pi-gremlins/side-chat-session-factory.test.js
npm run typecheck
```

### 3. Cover command-level regressions for side-chat settings isolation and active-session reuse

**What**

Update `extensions/pi-gremlins/side-chat-command.test.js` only where needed to prove issue #59 does not reopen side-chat-specific config or reload resources per prompt.

**References**

- `extensions/pi-gremlins/side-chat-command.ts`
- `extensions/pi-gremlins/side-chat-command.test.js`
- `extensions/pi-gremlins/side-chat-persistence.ts`
- `extensions/pi-gremlins/side-chat-transcript-state.ts`

**Acceptance criteria**

- Existing test for old `pi-gremlins.sideChat` settings still passes and confirms `skillPaths` cannot change session `tools` or inject side-chat-specific skill behavior.
- Add or preserve explicit negative assertions that any legacy side-chat skill-path sentinel (for example `ISSUE_59_LEGACY_SIDE_CHAT_SKILL_PATH_SHOULD_NOT_LEAK`) is absent from `prompt`, `systemPrompt`, and direct `resources` for `/gremlins:chat` and `/gremlins:tangent`.
- Active session reuse still constructs one resource loader for repeated prompts in the same side-chat mode.
- `chat` continues to capture only the origin parent transcript snapshot; `tangent` still does not include parent transcript snapshots.
- Tool-backed exchanges still persist as completed side-chat entries without leaking side-chat custom entries into parent context.

**Guardrails**

- Do not broaden command behavior or add UI controls for skills.
- Do not alter persistence entry shape unless a failing test proves it is required.

**Verification**

```bash
npm test -- extensions/pi-gremlins/side-chat-command.test.js
```

### 4. Align PRD/ADR documentation in place

**What**

Update the existing side-chat governance docs to reflect issue #59 as a follow-on to PRD-0008 / ADR-0008. Do not create a new PRD/ADR unless implementation discovers a material architecture decision beyond fresh child skill loading.

**References**

- `docs/prd/0008-side-chat-sessions-use-sdk-default-tools-and-extension-custom-tools.md`
- `docs/adr/0008-sdk-default-side-chat-tool-capabilities.md`
- `docs/prd/README.md` and `docs/adr/README.md` only if document status/related issue rows require index text updates

**Acceptance criteria**

- PRD-0008 related links mention issue #59.
- PRD-0008 history/status or change-log section notes issue #59 as the follow-on that re-allows fresh child-session skill guidance while preserving PRD-0008 isolation.
- PRD scope/acceptance/technical surface clarify that side-chat may load intended skills and skill prompt guidance through the fresh child resource loader, without side-chat-specific skill path config and without parent skill inheritance.
- ADR-0008 decision/constraints/verification clarify that fresh child skills are allowed and parent skill context is still prohibited.
- ADR-0008 history/status or consequences section mentions issue #59 and the narrowed change from “all skills stripped” to “parent/legacy skill context stripped; fresh child skills allowed.”
- Language that currently says all skills are stripped is revised to distinguish parent-loaded skills from fresh child-session skill resources.
- Existing PRD/ADR status remains coherent; no new document number is introduced unless the maintainer explicitly decides issue #59 warrants supersession.
- If `docs/prd/README.md` or `docs/adr/README.md` contains related-issue/status summary text for PRD-0008/ADR-0008, update only those rows to mention issue #59 consistently.

**Guardrails**

- Do not mark unrelated docs completed/accepted.
- Do not re-author PRD-0007/ADR-0007 as active authority.
- Do not create a new PRD/ADR or change document status unless maintainers explicitly require supersession.

**Verification**

Manual re-read of the edited PRD/ADR and, if touched, their README index tables.

### 5. Update user-facing README and changelog

**What**

Revise user-facing docs to describe skill prompt support accurately.

**References**

- `README.md`
- `CHANGELOG.md`

**Acceptance criteria**

- README side-chat section says side-chat uses SDK default tools, enabled extension custom tools, and fresh child-session skill guidance/resources where available.
- README isolation bullets distinguish fresh child skills from forbidden parent-loaded skills, prompts, themes, AGENTS/context files, primary-agent markdown, parent transcript history, and hidden parent context.
- CHANGELOG `[Unreleased]` includes a concise issue #59 bullet, referencing PRD-0008/ADR-0008 or their revised wording.

**Guardrails**

- Do not change install/package instructions or gremlin sub-agent child-session contract except where side-chat-specific text requires clarification.

**Verification**

Manual re-read of README side-chat section and changelog `[Unreleased]` entries.

### 6. Run focused and full verification

**What**

Run the smallest relevant tests first, then repository checks.

**References**

- `package.json`
- `extensions/pi-gremlins/*.test.js`
- `tsconfig.json`

**Acceptance criteria**

All commands pass, or any failure is explained with exact output and a follow-up fix.

**Guardrails**

- Do not claim verification without tool output.
- Do not skip full checks after changing runtime/docs/tests unless blocked by environment failure.

**Verification commands**

```bash
npm test -- extensions/pi-gremlins/side-chat-session-factory.test.js
npm test -- extensions/pi-gremlins/side-chat-command.test.js
npm test
npm run typecheck
npm run check
```

## Risks / Unknowns

- **Observed:** Current code forcibly disables skills and empties diagnostics in `createSideChatResourceLoader`.
- **Observed:** Current PRD/ADR/README text says side-chat strips skills, so docs must be updated with the implementation.
- **Inferred:** `DefaultResourceLoader` may already know how to compose skill guidance into the system prompt; implementation should use that native path where possible instead of duplicating SDK prompt-generation logic.
- **Unknown:** Exact SDK wording/shape for skill prompt injection and diagnostics in Pi 0.69.0; tests should verify capability and boundaries without overfitting to uncontrolled text.
- **Unknown:** Whether skill diagnostics are surfaced only through `getSkills()` or also through session creation results. Preserve them at the resource-loader level at minimum, and add stronger surfacing only if SDK behavior supports it cleanly.
