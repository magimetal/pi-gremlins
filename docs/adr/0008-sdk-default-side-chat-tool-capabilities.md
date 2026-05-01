# ADR-0008: SDK-Default Side-Chat Tool Capabilities

- **Status:** Accepted
- **Date:** 2026-05-01
- **Decision Maker:** Magi Metal
- **Related:** GitHub issue [#57](https://github.com/magimetal/pi-gremlins/issues/57), [PRD-0008](../prd/0008-side-chat-sessions-use-sdk-default-tools-and-extension-custom-tools.md), [PRD-0007](../prd/0007-allow-side-chat-sessions-to-use-approved-skills-and-tools.md), [PRD-0005](../prd/0005-persistent-overlay-side-chat.md), [ADR-0005](0005-persistent-overlay-side-chat.md), [ADR-0003](0003-unified-agent-discovery-and-primary-agent-prompt-injection-in-pi-gremlins.md)
- **Supersedes:** [ADR-0007](0007-guarded-side-chat-tool-capabilities.md)

## Context

ADR-0007 replaced ADR-0005's absolute zero-tool side-chat boundary with a guarded, side-chat-specific capability profile. That accepted design used optional `.pi/settings.json` side-chat configuration to select allowed tools and skills.

The architecture has changed again for issue #57. Side-chat should not introduce or depend on a pi-gremlins-specific side-chat capability configuration file shape. Instead, a side-chat child session should use the Pi SDK's default built-in tools by omitting the `tools` option when creating the child session. Extension-provided custom tools should be made available through a fresh side-chat resource-loading path that reloads enabled extensions without inheriting parent prompt, transcript, `AGENTS`, prompt, theme, or skill context.

This materially changes ADR-0007 because the source of side-chat capability authority moves from an explicit allowlist profile to SDK defaults plus extension custom tools. ADR-0005 remains active for persistent overlay behavior, chat/tangent thread semantics, reset markers, parent-context filtering, and no per-side-chat model/thinking overrides, except where its zero-tool boundary was already superseded.

## Decision Drivers

- Use platform defaults instead of a pi-gremlins-specific side-chat config contract.
- Preserve side-chat isolation from parent transcript/history, system prompt, primary-agent markdown, prompts, themes, skills, `AGENTS` files, and unapproved parent prompt material.
- Allow side-chat to use the SDK default built-in tools such as `read`, `bash`, `edit`, and `write` without maintaining a duplicate allowlist.
- Allow enabled extensions to expose custom tools to side-chat through a fresh resource loader.
- Avoid leaking non-tool extension surfaces into the side-chat prompt or context where possible.
- Keep side-chat system prompts explicit about the child session boundary and available capability model.
- Preserve ADR-0005 overlay persistence and chat/tangent semantics.

## Options Considered

### Option A: Keep ADR-0007 side-chat capability profiles

- Pros:
  - Explicit allowlist behavior is easy to inspect in pi-gremlins code.
  - Existing ADR-0007 tests and PRD language map directly to profile resolution.
  - Supports conversational-only side-chat by configuration.
- Cons:
  - Adds side-chat-specific configuration that duplicates platform capability policy.
  - Requires pi-gremlins to track built-in tool identity and semantics.
  - Makes SDK default behavior unavailable unless re-modeled in the profile contract.

### Option B: Inherit the parent session's complete runtime surface

- Pros:
  - Maximum capability parity with the parent session.
  - Minimal separate side-chat capability plumbing.
- Cons:
  - Violates ADR-0003 and ADR-0005 isolation boundaries.
  - Risks leaking parent transcript, prompt, `AGENTS`, skills, prompts, themes, and extension context into the side-chat.
  - Makes the side-chat overlay a parent-session clone rather than an isolated child conversation.

### Option C: Use SDK defaults plus extension custom tools through fresh side-chat resource loading

- Pros:
  - Removes side-chat-specific capability configuration.
  - Delegates built-in tool defaults to the SDK by omitting `tools` during child-session creation.
  - Keeps custom tool discovery aligned with enabled extensions while using a fresh side-chat resource loader rather than parent runtime state.
  - Preserves the ability to keep parent transcript and prompt surfaces isolated from side-chat.
- Cons:
  - Side-chat is no longer conversational-only by default once SDK defaults are active.
  - Built-in tool availability follows SDK defaults, so behavior can change with SDK policy.
  - Fresh extension loading must defensively strip or avoid non-tool resources to prevent context leakage.
  - Tests must distinguish intended SDK default capability from forbidden parent context inheritance.

## Decision

Chosen: **Option C: Use SDK defaults plus extension custom tools through fresh side-chat resource loading**.

Rationale: Side-chat should rely on the same default built-in tool behavior as a normal SDK child session instead of maintaining a parallel pi-gremlins allowlist or side-chat `.pi/settings.json` contract. Custom extension tools are still useful, but they must be exposed through a fresh side-chat `DefaultResourceLoader` path so side-chat can discover enabled extension tools without inheriting the parent session's prompt, history, `AGENTS`, prompts, themes, skills, or other context surfaces.

The implementation must follow these architectural constraints:

- Do not define or read side-chat-specific `.pi/settings.json` capability profiles for issue #57.
- When creating a side-chat child session, omit the `tools` option so SDK defaults activate.
- Treat SDK default built-in tools as platform-owned capability policy; pi-gremlins must not duplicate the built-in allowlist in a side-chat config resolver.
- Use a fresh side-chat child `DefaultResourceLoader` to reload enabled extensions and expose custom extension tools.
- Strip, ignore, or avoid non-tool extension surfaces where possible so prompts, themes, skills, `AGENTS`, primary-agent markdown, and parent prompt material do not leak into side-chat context.
- Do not inherit parent transcript/history except for ADR-0005's `chat` mode parent transcript snapshot at thread origin; `tangent` still receives no parent transcript.
- Keep side-chat system prompt text explicit about the side-chat boundary, SDK-default built-in tools, extension custom tool availability, and prohibited parent-context inheritance.
- Preserve ADR-0005 persistent overlay semantics, custom entry persistence, reset markers, branch restore behavior, context filtering, chat/tangent distinction, and no per-side-chat model/thinking overrides.
- Future changes that add side-chat-specific config, alter default tool policy, or allow non-tool extension surfaces into side-chat require a new ADR or supersession.

## Consequences

- **Positive:** Side-chat capability behavior aligns with SDK defaults instead of a bespoke pi-gremlins configuration contract.
- **Positive:** Built-in tools such as `read`, `bash`, `edit`, and `write` can be available when the SDK default tool set provides them.
- **Positive:** Extension custom tools can be available to side-chat without reusing parent session state.
- **Positive:** The architecture removes `.pi/settings.json` side-chat profile migration and validation work.
- **Negative:** Side-chat has broader default capability than ADR-0005's zero-tool model and ADR-0007's explicit allowlist model.
- **Negative:** Capability drift can occur if SDK default tools change.
- **Negative:** Extension loading needs careful filtering so custom tools do not drag parent prompt/context/resource surfaces into the child session.
- **Follow-on constraints:** Any side-chat-specific capability configuration, custom built-in-tool allowlist, or inheritance of non-tool parent resources must be treated as a material architecture change.

## Implementation Impact

- **apps/api:** N/A. Standalone Pi extension package; no `apps/api` workspace.
- **apps/web:** N/A. No web frontend package.
- **packages/shared:** N/A. No shared package contract change.
- **packages/utils:** N/A. No standalone utils package in this repository.
- **Migration/ops:**
  - No persistent data migration is required for existing `pi-gremlins:side-chat-thread` or `pi-gremlins:side-chat-reset` entries.
  - Remove or avoid introducing side-chat `.pi/settings.json` capability profile documentation and runtime handling.
  - Side-chat child session creation changes from explicit `tools: []` or profile-selected `tools` to omitting `tools` for SDK defaults.
  - Side-chat resource loading gains a fresh child `DefaultResourceLoader` path for enabled extension custom tools.
  - Documentation should state that side-chat uses SDK-default built-in tools plus extension custom tools, while parent prompt/history/resource inheritance remains prohibited.

## Verification

- **Automated:**
  - Session-factory tests prove side-chat child session creation omits `tools` so SDK defaults apply.
  - Tests prove side-chat does not read or require side-chat-specific `.pi/settings.json` capability profiles.
  - Resource-loader tests prove a fresh side-chat child `DefaultResourceLoader` exposes enabled extension custom tools.
  - Negative tests prove parent transcript/history, prompt, primary-agent markdown, prompts, themes, skills, `AGENTS`, and non-tool extension surfaces do not leak into side-chat context where the implementation can filter them.
  - Prompt tests prove `chat` and `tangent` prompts accurately describe SDK-default built-in tools, extension custom tools, and parent-context isolation.
  - Regression tests prove `chat` still captures only the parent transcript snapshot at thread origin and `tangent` still captures no parent transcript.
  - Regression tests prove side-chat persistence, reset markers, branch restore, and context filtering retain ADR-0005 behavior.
- **Manual:**
  - Open `/gremlins:chat` and verify SDK-default tools are available without side-chat `.pi/settings.json` config.
  - Open `/gremlins:tangent` and verify tool availability does not include parent transcript or prompt inheritance.
  - Enable an extension with a custom tool and verify side-chat can see the custom tool through fresh resource loading.
  - Verify extension prompts/themes/skills/`AGENTS`/primary-agent material are absent from side-chat context unless a future ADR explicitly allows them.

## Notes

ADR-0008 supersedes ADR-0007 in full. ADR-0007 remains preserved as the record of the intermediate guarded capability-profile design, but its `.pi/settings.json` side-chat profile, explicit side-chat allowlist, and conversational-only default are no longer active architecture.

ADR-0005 remains active for persistent overlay UX, per-mode thread behavior, custom entry persistence, reset handling, context filtering, tangent clean-context behavior, and no per-side-chat model/thinking overrides. Its zero-tool side-chat statement is superseded first by ADR-0007 and now by this ADR.

This decision authorizes tools, not parent state sharing. Side-chat capability does not authorize inheriting the parent session transcript, prompt, primary-agent markdown, prompts, themes, skills, `AGENTS`, or non-tool extension resources.

## Status History

- 2026-05-01: Accepted for issue #57; supersedes ADR-0007's guarded side-chat capability profile with SDK-default built-in tools plus extension custom tools through fresh side-chat resource loading.
