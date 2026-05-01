# PRD-0008: Side-Chat Sessions Use SDK Default Tools and Extension Custom Tools

- **Status:** Completed
- **Date:** 2026-05-01
- **Author:** Magi Metal
- **Related:** GitHub issue [#57](https://github.com/magimetal/pi-gremlins/issues/57), GitHub issue [#59](https://github.com/magimetal/pi-gremlins/issues/59), PR #58, [PRD-0005](0005-persistent-overlay-side-chat.md), [PRD-0007](0007-allow-side-chat-sessions-to-use-approved-skills-and-tools.md), [ADR-0008](../adr/0008-sdk-default-side-chat-tool-capabilities.md), [ADR-0007](../adr/0007-guarded-side-chat-tool-capabilities.md), [ADR-0005](../adr/0005-persistent-overlay-side-chat.md), [ADR-0003](../adr/0003-unified-agent-discovery-and-primary-agent-prompt-injection-in-pi-gremlins.md), [ADR-0004](../adr/0004-side-chat-absorption-from-pi-gizmo.md)
- **Supersedes:** [PRD-0007](0007-allow-side-chat-sessions-to-use-approved-skills-and-tools.md)

## Problem Statement

PRD-0007 completed an approved/configurable side-chat capability model using a `.pi/settings.json` allowlist. The requested scope for issue #57 and PR #58 has materially changed: side-chat should not have side-chat-specific capability configuration. Instead, side-chat child sessions should use the Pi SDK's default built-in tools plus custom tools contributed by enabled extensions, while preserving the side-chat overlay's persistence and isolation guarantees.

The stale configurable allowlist model adds product surface area the operator no longer wants and makes side-chat behavior diverge from the SDK's default capability contract. Side-chat needs to become workspace-capable by default through the same SDK/extension tool sources as normal child sessions, without inheriting parent transcript/history or unrelated parent resources.

## User Stories

- As an operator, I can open `/gremlins:chat` or `/gremlins:tangent` and have the side-chat assistant use the SDK default built-in tools (`read`, `bash`, `edit`, `write`) without adding side-chat-specific configuration.
- As an operator, I can use custom tools exposed by enabled extensions in side-chat when those extensions are active, without maintaining a separate side-chat allowlist.
- As an operator, I can use intended skills and SDK-native skill prompt guidance loaded through the fresh side-chat child resource loader, without a side-chat-specific skill path setting.
- As an operator, I can trust that side-chat does not inherit the parent transcript, live history, AGENTS files, prompts, themes, parent-loaded skills, or primary-agent material except where needed for extension tool operation.
- As an operator, I can keep the existing persistent overlay behavior while tool-backed side-chat exchanges are saved and restored correctly.
- As a maintainer, I can verify the implementation with tests that prove default SDK tools and extension custom tools reach side-chat without `.pi/settings.json` side-chat configuration.

## Scope

### In Scope

- Remove the PRD-0007 side-chat-specific `.pi/settings.json` capability profile/allowlist requirement from the issue #57 product scope.
- Create side-chat sessions with SDK default built-in tools available: `read`, `bash`, `edit`, and `write`.
- Include custom tools supplied by enabled extensions in side-chat sessions through the normal SDK/extension tool path.
- Allow intended skills and skill diagnostics to flow through the side-chat child session's fresh `DefaultResourceLoader`, so SDK-native skill guidance can be included in the child session prompt.
- Ensure no `pi-gremlins.sideChat` tool/skill configuration is required, read, documented, or tested as the product behavior for this feature.
- Preserve persistent overlay behavior from PRD-0005 and ADR-0005: resume, `:new`, chat-vs-tangent separation, completed-exchange persistence, reset markers, branch restore behavior, context filtering, and tangent's clean-context guarantee.
- Preserve isolation from parent transcript/history, parent prompts, themes, parent-loaded skills, AGENTS files, primary-agent markdown, and unrelated parent resources unless a specific extension tool requires its own extension-provided runtime context.
- Update side-chat prompt/capability text so `chat` and `tangent` sessions do not falsely claim they have no tools.
- Add or update tests for SDK default built-in tools, extension custom tools, absence of side-chat config, prompt/capability text, isolation guarantees, and persistence of tool-backed side-chat responses.
- Update relevant product/architecture documentation so issue #57 and PR #58 no longer describe the completed configurable allowlist as the active requirement.

### Out of Scope

- Side-chat-specific `.pi/settings.json` capability profiles, allowlists, per-mode tool lists, or skill path lists.
- Inheriting parent-loaded skills, parent skill prompt material, or primary-agent/sub-agent markdown as side-chat skills.
- Preserving conversational-only side-chat as the default behavior for issue #57.
- A side-chat UI for managing tool permissions.
- Per-side-chat model or thinking overrides.
- Multiple simultaneous chat threads or tangent threads of the same mode.
- Injecting, summarizing, or handing off side-chat results into the parent session.
- Changing overlay layout, keyboard controls, or transcript rendering except where necessary to represent tool-backed responses accurately.
- Reworking extension installation/enabling semantics beyond consuming the custom tools already exposed by enabled extensions.

## Acceptance Criteria

- [x] `/gremlins:chat` and `/gremlins:tangent` create side-chat child sessions with SDK default built-in tools available: `read`, `bash`, `edit`, and `write`.
- [x] Side-chat child sessions include custom tools from enabled extensions through the normal extension tool mechanism.
- [x] No side-chat-specific `.pi/settings.json` configuration, `pi-gremlins.sideChat` allowlist, per-mode capability profile, or side-chat skill path list is required or read for issue #57/#59 behavior.
- [x] Side-chat session creation does not pass an empty tool list or a side-chat-specific allowlist that suppresses SDK default built-in tools.
- [x] `chat` mode still captures the parent transcript only at thread origin, and `tangent` mode still starts without parent transcript context even when tools are available.
- [x] Side-chat allows fresh child-session skills and skill diagnostics through the child resource-loader boundary so SDK-native skill guidance can reach the side-chat runtime.
- [x] Side-chat does not inherit parent live history, AGENTS files, prompts, themes, parent-loaded skills, primary-agent markdown, or unrelated parent resources except as required by enabled extension tool operation.
- [x] Side-chat system prompts for both modes accurately describe that tools may be available and do not state that the assistant is conversational-only/no-tool.
- [x] Existing overlay persistence behavior is preserved: resume, `:new`, per-mode reset markers, completed-exchange persistence, chat-vs-tangent separation, branch restore behavior, and context filtering continue to work.
- [x] Tool-backed side-chat responses persist as completed exchanges without leaking side-chat custom entries into parent LLM context.
- [x] Automated tests cover SDK default built-in tool availability, enabled extension custom tool availability, absence of side-chat config behavior, prompt/capability text, parent-context isolation, and persistence around tool-backed responses.
- [x] Documentation/tests for the superseded PRD-0007 configurable allowlist behavior are removed or revised so PR #58 reflects SDK defaults plus extension custom tools.

## Technical Surface

- **Side-chat session factory:** `extensions/pi-gremlins/side-chat-session-factory.ts` — should rely on SDK default built-in tools plus extension custom tools rather than explicit `tools: []` or side-chat allowlists, and should allow fresh child-session skills/diagnostics through the child resource loader without inheriting parent-loaded skills.
- **Side-chat commands/runtime:** `extensions/pi-gremlins/side-chat-command.ts` — persistent overlay session creation, resume, reset, context filtering, and transcript finalization must remain stable.
- **Gremlin/session tool wiring:** `extensions/pi-gremlins/gremlin-session-factory.ts` and related SDK integration points — reference for how normal child sessions receive default and extension tools.
- **Extension custom tools:** extension discovery/enabling surfaces that contribute custom tools to SDK sessions.
- **Persistence/transcript:** `extensions/pi-gremlins/side-chat-persistence.ts`, `extensions/pi-gremlins/side-chat-transcript-state.ts` — must continue to persist completed side-chat exchanges and filter side-chat custom data.
- **Tests:** `extensions/pi-gremlins/side-chat-session-factory.test.js`, `extensions/pi-gremlins/side-chat-command.test.js`, `extensions/pi-gremlins/side-chat-persistence.test.js`, plus extension/tool-wiring tests if needed to prove custom tool propagation.
- **Related ADRs:** [ADR-0008](../adr/0008-sdk-default-side-chat-tool-capabilities.md) documents the implemented SDK-default-plus-extension-tools architecture and supersedes [ADR-0007](../adr/0007-guarded-side-chat-tool-capabilities.md); [ADR-0005](../adr/0005-persistent-overlay-side-chat.md) and [ADR-0003](../adr/0003-unified-agent-discovery-and-primary-agent-prompt-injection-in-pi-gremlins.md) remain binding for overlay persistence and isolation.

## UX Notes

The overlay command surface remains unchanged: `/gremlins:chat`, `/gremlins:chat:new`, `/gremlins:tangent`, and `/gremlins:tangent:new` keep their current resume/reset semantics. The user should not have to discover or edit a side-chat-specific settings block to get the requested tools.

Prompt behavior should align with runtime capability. Side-chat should not say it has no tools or workspace access when SDK default tools, extension custom tools, or fresh child-session skill guidance are available. It should still communicate that the side-chat is isolated from parent transcript/history and parent-loaded resources except for the existing `chat` origin snapshot behavior.

## Open Questions

- Resolved: ADR-0008 supersedes ADR-0007 and records the SDK-default-plus-extension-tools decision.
- Resolved: side-chat uses a fresh `DefaultResourceLoader` to reload enabled extensions, preserves extension tool records, allows fresh child-session skills/diagnostics for SDK-native skill guidance, and strips prompts/themes/AGENTS/append prompt material before session creation.

## Completion Summary

Implementation for issue #57 / PR #58 removed the side-chat configuration/allowlist path, omitted explicit `tools` during side-chat child session creation so SDK defaults apply, loaded enabled extension custom tools through a fresh `DefaultResourceLoader`, awaited reload before session creation, preserved extension tool records, stripped non-tool resources, and preserved active-session reuse and overlay persistence behavior. Follow-on issue #59 re-allows fresh child-session skills and diagnostics through that same child resource-loader boundary while keeping parent-loaded skills and legacy side-chat skill paths isolated.

Verification evidence from implementation and execution review: targeted side-chat tests passed (16 pass / 0 fail), typecheck passed, full `npm test` passed (96 pass / 0 fail), `npm run check` passed, and execution review returned PASS.

## Revision History

- 2026-05-01: Revised for issue #59: fresh child-session skills and diagnostics may flow through the side-chat child resource loader; parent-loaded skills and side-chat-specific skill path settings remain isolated.
- 2026-05-01: Completed after issue #57 / PR #58 implementation and execution review PASS; acceptance criteria verified by targeted tests, typecheck, full test suite, and check command.
- 2026-05-01: Active superseding PRD-0007 after issue #57 / PR #58 scope changed from configurable allowlists to SDK default built-in tools plus enabled extension custom tools with no side-chat-specific configuration.
