# PRD-0007: Allow Side-Chat Sessions to Use Approved Skills and Tools

- **Status:** Completed
- **Date:** 2026-05-01
- **Author:** Magi Metal
- **Related:** GitHub issue [#57](https://github.com/magimetal/pi-gremlins/issues/57), [PRD-0005](0005-persistent-overlay-side-chat.md), [ADR-0007](../adr/0007-guarded-side-chat-tool-capabilities.md), [ADR-0005](../adr/0005-persistent-overlay-side-chat.md), [ADR-0003](../adr/0003-unified-agent-discovery-and-primary-agent-prompt-injection-in-pi-gremlins.md), [ADR-0004](../adr/0004-side-chat-absorption-from-pi-gizmo.md)
- **Supersedes:** None. Refines PRD-0005's completed zero-tool side-chat scope for a new optional-capability enhancement.

## Problem Statement

Persistent Gremlins side-chat currently always creates isolated zero-tool child sessions. `extensions/pi-gremlins/side-chat-session-factory.ts` hard-codes `tools: []`, uses `createEmptyGremlinResources()`, and tells the assistant it has no tools or workspace access. That is safe, but it prevents the side-chat overlay from answering common follow-up questions that require approved file-reading or workspace-inspection capability.

Issue #57 asks for side-chat and tangent sessions to optionally use approved skills and tools while preserving the existing overlay persistence, context isolation, reset semantics, and ability to run conversational-only side-chat.

## User Stories

- As an operator, I can enable a side-chat session with approved file-read or workspace-inspection tools so that I can ask project-aware questions without leaving the persistent overlay.
- As an operator, I can keep side-chat conversational-only when I do not want the side thread to use tools or inspect the workspace.
- As an operator, I can tell from the side-chat prompt behavior whether tools or skills are available, so the assistant does not falsely claim it cannot inspect files when it can.
- As an operator using tangent mode, I can opt into approved capabilities without accidentally inheriting parent transcript context.
- As a maintainer, I can verify the approved capability path with tests that prove only allowlisted tools and resources reach the side-chat child session.

## Scope

### In Scope

- Add a configuration or equivalent documented mechanism that lets side-chat sessions opt into approved tools.
- Support at least a file-read/workspace-inspection capability class through approved tool IDs or documented Pi SDK equivalents.
- Support approved skills/resources through the normal gremlin resource mechanism or a documented side-chat-specific equivalent that keeps the same isolation guarantees.
- Ensure tool and skill access is allowlisted/scoped rather than inherited wholesale from the parent session.
- Preserve conversational-only side-chat as the default or provide a documented, tested migration if the default changes.
- Update side-chat system prompt text dynamically so `chat` and `tangent` sessions accurately describe active capabilities.
- Preserve existing persistent overlay behavior: resume, `:new`, chat-vs-tangent separation, completed-exchange persistence, reset markers, context filtering, and tangent's clean-context guarantee.
- Add automated tests for tool-enabled configuration, prompt capability text, allowlist enforcement, and persistence around tool-backed side-chat responses.
- Update the architecture documentation for the ADR-0005 decision change from always zero-tool to optional approved capabilities.

### Out of Scope

- Unrestricted inheritance of parent tools, extensions, prompts, themes, AGENTS files, primary-agent markdown, or arbitrary parent resources.
- Enabling write, shell, network, or mutation-capable tools by default.
- New side-chat UI surfaces for managing tool permissions unless required by the chosen configuration mechanism.
- Per-side-chat model or thinking overrides.
- Multiple simultaneous chat threads or tangent threads of the same mode.
- Injecting, summarizing, or handing off side-chat results into the parent session.
- Changing overlay layout, keyboard controls, or transcript rendering except where necessary to represent tool-backed responses accurately.

## Acceptance Criteria

- [x] With no tool/skill configuration, `/gremlins:chat` and `/gremlins:tangent` remain conversational-only, or the implementation includes an explicit migration note and tests for the changed default.
- [x] A documented approved-capability configuration can enable side-chat access to file-read/workspace-inspection tools or their Pi SDK equivalents.
- [x] Side-chat session creation passes only approved tool IDs to `createAgentSession`; disallowed or unconfigured tools are not passed.
- [x] Approved skills/resources are available to side-chat through the normal gremlin mechanism or a documented equivalent, without inheriting unrelated parent resources.
- [x] `chat` mode still captures the parent transcript only at thread origin, and `tangent` mode still starts without parent transcript context even when tools or skills are enabled.
- [x] Side-chat system prompts for both modes accurately state whether tools, workspace inspection, or skills are available.
- [x] Existing overlay persistence behavior is preserved: resume, `:new`, per-mode reset markers, completed-exchange persistence, chat-vs-tangent separation, and context filtering continue to work.
- [x] Tool-backed side-chat responses persist as completed exchanges without leaking side-chat custom entries into parent LLM context.
- [x] Automated tests cover disabled/default configuration, enabled approved-tool configuration, prompt text for enabled and disabled states, allowlist rejection, and persistence around tool-backed responses.
- [x] ADR documentation records the decision change from mandatory zero-tool side-chat to optional approved skills/tools, with links back to PRD-0007 from ADR-0005 and/or ADR-0007.

## Technical Surface

- **Side-chat session factory:** `extensions/pi-gremlins/side-chat-session-factory.ts` — current zero-tool configuration, resource loader, and prompt text.
- **Side-chat commands/runtime:** `extensions/pi-gremlins/side-chat-command.ts` — persistent overlay session creation, resume, reset, context filtering, and transcript finalization.
- **Gremlin session factory:** `extensions/pi-gremlins/gremlin-session-factory.ts` — existing child-session tool passing and isolated resource-loader primitives.
- **Gremlin definitions/resources:** `extensions/pi-gremlins/gremlin-definition.ts` and related discovery code if the implementation reuses gremlin frontmatter or resource loading for approved skills/tools.
- **Persistence/transcript:** `extensions/pi-gremlins/side-chat-persistence.ts`, `extensions/pi-gremlins/side-chat-transcript-state.ts` — must continue to persist completed side-chat exchanges and filter side-chat custom data.
- **Tests:** `extensions/pi-gremlins/side-chat-session-factory.test.js`, `extensions/pi-gremlins/side-chat-command.test.js`, `extensions/pi-gremlins/side-chat-persistence.test.js`, plus gremlin factory/discovery tests if the approved-skill path touches those contracts.
- **Related ADRs:** [ADR-0007](../adr/0007-guarded-side-chat-tool-capabilities.md) records the guarded capability-profile decision if accepted as the implementation ADR; [ADR-0005](../adr/0005-persistent-overlay-side-chat.md) must remain cross-linked to the decision change; [ADR-0003](../adr/0003-unified-agent-discovery-and-primary-agent-prompt-injection-in-pi-gremlins.md) isolation remains binding.

## UX Notes

The overlay should continue to behave like the existing persistent side-chat surface. Capability changes should be visible through assistant behavior and accurate prompt text rather than by changing the command surface. `/gremlins:chat`, `/gremlins:chat:new`, `/gremlins:tangent`, and `/gremlins:tangent:new` must keep their current resume/reset semantics.

When capabilities are disabled, the assistant should continue to state that it cannot inspect files or call tools. When approved capabilities are enabled, the assistant should state the available capability class narrowly and avoid implying unrestricted workspace or mutation access.

## Resolved Questions

- The approved read-only workspace tool IDs are `read`, `grep`, `find`, and `ls`.
- Approved side-chat capabilities are configured through optional project `.pi/settings.json` entries under `pi-gremlins.sideChat.chat` and `pi-gremlins.sideChat.tangent`.
- Approved skills are selected by explicit `.pi/skills/.../*.md` `skillPaths`; skill loading requires the `read` tool and fails closed on loader diagnostics.
- `chat` and `tangent` support separate capability profiles so each mode can remain conversational-only or opt into approved tools/skills independently.

## Implementation Summary

- Added a side-chat capability resolver that defaults to explicit `tools: []`, reads optional per-mode profiles from `.pi/settings.json`, and allowlists only `read`, `grep`, `find`, and `ls`.
- Added guarded approved-skill support for project `.pi/skills/` Markdown paths, requiring the `read` tool and rejecting absolute paths, parent traversal, paths outside `.pi/skills/`, non-files, and loader diagnostics.
- Updated side-chat session creation so prompts derive from the resolved capability profile, approved tools are passed explicitly, and parent resources/prompts/extensions/themes/`AGENTS`/primary-agent markdown still do not leak.
- Preserved ADR-0005 overlay persistence, reset, chat/tangent separation, context filtering, and tangent clean-context behavior.

## Verification Summary

- Targeted side-chat tests: 30 pass / 0 fail.
- `npm run typecheck`: pass.
- `npm test`: 110 pass / 0 fail.
- `npm run check`: pass.
- Execution review verdict: PASS.

## Revision History

- 2026-05-01: Marked Completed after implementation, passing verification, and execution review PASS for issue #57.
- 2026-05-01: Active after approved implementation plan.
- 2026-05-01: Draft created for GitHub issue #57.
