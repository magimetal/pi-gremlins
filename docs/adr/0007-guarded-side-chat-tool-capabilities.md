# ADR-0007: Guarded Side-Chat Tool Capabilities

- **Status:** Accepted
- **Date:** 2026-05-01
- **Decision Maker:** magimetal
- **Related:** GitHub issue [#57](https://github.com/magimetal/pi-gremlins/issues/57), [PRD-0007](../prd/0007-allow-side-chat-sessions-to-use-approved-skills-and-tools.md), [PRD-0005](../prd/0005-persistent-overlay-side-chat.md), [ADR-0005](0005-persistent-overlay-side-chat.md), [ADR-0003](0003-unified-agent-discovery-and-primary-agent-prompt-injection-in-pi-gremlins.md)
- **Supersedes:** ADR-0005 zero-tool side-chat boundary only. Persistent overlay, thread persistence, reset markers, parent-context filtering, chat/tangent semantics, and no per-side-chat model/thinking overrides remain in force.

## Context

ADR-0005 made persistent overlay side-chat deliberately conservative: side-chat child sessions used `tools: []`, inherited parent model/thinking fallback, and stayed isolated from parent session state, history, prompt, extensions, skills, prompts, themes, `AGENTS` files, and primary-agent markdown. That boundary was correct while restoring persistent multi-turn side-chat because it prevented the overlay from becoming an unreviewed workspace actor.

Issue #57 changes the desired architecture. Side-chat should remain usable as a conversational-only overlay, but it may also use explicitly approved tools or skills when the host exposes a guarded capability profile for that side-chat mode. The prior absolute zero-tool rule is too narrow for workflows where the operator wants a persistent side conversation that can inspect or act through a constrained, auditable capability set.

The architectural risk is prompt and capability leakage. A side-chat session must not become a backdoor into the parent session's full state or tool surface. Any capability escalation has to be explicit, allowlisted, scoped, and reflected accurately in the side-chat system prompt.

## Decision Drivers

- Isolation: side-chat must remain separated from parent session state, live history, system prompt, primary-agent markdown, extensions, themes, prompts, `AGENTS` files, and unapproved parent prompt material.
- Safety: side-chat capabilities must fail closed unless explicitly allowed by a capability profile.
- Accuracy: side-chat prompt text must describe the actual capability profile rather than hard-coding "no tools" when tools are enabled.
- Compatibility: conversational-only side-chat remains supported and should still map to an empty capability profile.
- Persistence stability: ADR-0005 overlay persistence and reset semantics must not change for issue #57.
- Testability: factory, prompt, command, persistence, and isolation behavior must be verifiable without relying on broad integration assumptions.

## Options Considered

### Option A: Keep side-chat permanently zero-tool

- Pros:
  - Preserves the simplest and safest ADR-0005 boundary.
  - Avoids tool approval, prompt-generation, and capability-profile complexity.
  - Keeps existing tests and documentation mostly unchanged.
- Cons:
  - Blocks issue #57's requested approved tools/skills workflow.
  - Forces users back to the parent chat for any workspace-aware side investigation.
  - Treats the initial conservative boundary as permanent even when narrower guarded capability surfaces are available.

### Option B: Inherit parent session tools and skills automatically

- Pros:
  - Gives side-chat maximum immediate usefulness.
  - Requires less explicit configuration work.
- Cons:
  - Violates ADR-0003 and ADR-0005 isolation guarantees.
  - Leaks parent capability assumptions into a separate overlay session.
  - Makes side-chat prompt text, test coverage, and user expectations harder to trust.
  - Reopens the broad command-surface risk that side-chat absorption intentionally avoided.

### Option C: Allow side-chat capabilities only through an explicit guarded capability profile

- Pros:
  - Satisfies issue #57 while preserving isolation from parent session state and prompts.
  - Keeps conversational-only side-chat as the default or an explicitly representable profile.
  - Provides a single capability object to drive `createAgentSession` tool allowlists, approved skill loading, and system-prompt capability text.
  - Makes escalation explicit, scoped, and testable.
- Cons:
  - Adds a new side-chat capability profile contract.
  - Requires prompt-generation and session-factory code to become profile-aware.
  - Requires negative regression tests for parent leakage and unapproved capability use.

## Decision

Chosen: **Option C: Allow side-chat capabilities only through an explicit guarded capability profile**.

Rationale: Side-chat can gain approved workspace-aware behavior without inheriting the parent session's full runtime surface. The architecture changes the absolute zero-tool rule into a guarded capability boundary: the default profile may still be conversational-only, but non-zero capabilities must be intentionally selected, allowlisted, and accurately described to the side-chat child session.

The implementation must follow these architectural constraints:

- Define a side-chat capability profile as the only source of truth for side-chat tools and approved skills.
- Treat the conversational-only profile as valid and equivalent to `tools: []` plus no approved skills.
- Pass only profile-approved tool identifiers to side-chat `createAgentSession`; do not inherit parent tools implicitly.
- Load only profile-approved side-chat skills, if supported by the profile; do not load arbitrary parent skills.
- Keep side-chat resource loading isolated from parent extensions, prompts, themes, `AGENTS` files, primary-agent markdown, and unapproved parent prompt material.
- Generate side-chat system-prompt capability text from the actual resolved capability profile.
- Preserve the distinction between `chat` and `tangent`: `chat` may still receive only its ADR-0005 parent transcript snapshot at thread origin, while `tangent` receives no parent transcript.
- Preserve ADR-0005 persistent overlay semantics, custom entry persistence, reset markers, branch restore behavior, and context filtering.
- Preserve ADR-0005's no per-side-chat model/thinking override decision unless a future ADR changes that boundary.
- Fail closed when a requested profile, tool, or skill is unknown, unavailable, ambiguous, or not approved for side-chat.
- Keep capability escalation explicit in code and tests; do not enable broad default workspace access as a side effect of opening the overlay.

## Consequences

- **Positive:** Side-chat can support approved tool/skill workflows requested by issue #57 without becoming a parent-session clone.
- **Positive:** Conversational-only mode remains available and easy to reason about.
- **Positive:** Prompt claims about tools and workspace access stay aligned with runtime capabilities.
- **Positive:** The side-chat boundary becomes auditable through one capability-profile contract.
- **Negative:** The session factory and command path need extra profile resolution and validation logic.
- **Negative:** Tests must cover profile-enabled and zero-capability variants, including negative leakage cases.
- **Follow-on constraints:** Future additions to side-chat capability sources, default enabled tools, skill resolution, or parent-state sharing require PRD/ADR review because they affect runtime safety boundaries and user-visible side-chat behavior.

## Implementation Impact

- **apps/api:** N/A. Standalone Pi extension package; no `apps/api` workspace.
- **apps/web:** N/A. No web frontend package.
- **packages/shared:** N/A. No shared package contract change.
- **packages/utils:** N/A. No standalone utils package in this repository.
- **Migration/ops:**
  - No persistent data migration required for existing `pi-gremlins:side-chat-thread` or `pi-gremlins:side-chat-reset` entries.
  - Existing persisted side-chat threads remain valid because persistence stores exchanges and reset markers, not capability profiles.
  - Runtime gains a side-chat capability profile resolution boundary.
  - README or command documentation should explain conversational-only behavior, approved capability behavior, failure modes, and isolation guarantees when implementation lands.
  - CHANGELOG should cite ADR-0007 when implementation lands.

## Verification

- **Automated:**
  - Factory tests prove the default/conversational profile produces `tools: []`, no approved skills, and prompt text that says no tools/workspace access.
  - Factory tests prove an approved profile passes only approved tool identifiers to side-chat `createAgentSession`.
  - Skill/resource-loader tests prove only approved side-chat skills are available and parent skills/prompts/themes/extensions/`AGENTS`/primary-agent markdown do not leak.
  - Prompt tests prove capability descriptions are generated from the resolved profile for chat and tangent modes.
  - Negative tests prove unknown, unavailable, ambiguous, or unapproved tools/skills fail closed.
  - Regression tests prove `chat` still captures only the parent transcript snapshot at thread origin and `tangent` still captures no parent transcript.
  - Regression tests prove side-chat persistence, reset markers, branch restore, and context filtering retain ADR-0005 behavior.
  - Full repository verification after implementation: `npm run typecheck`, `npm test`, and `npm run check`.
- **Manual:**
  - Open `/gremlins:chat` without an approved capability profile and verify conversational-only behavior and prompt wording.
  - Open side-chat with an approved capability profile and verify only listed tools/skills are available.
  - Attempt an unapproved tool/skill path and verify it is rejected with a clear notification or error.
  - Reload or navigate the active branch and verify restored overlay history is unchanged by capability profile support.

## Notes

This ADR supersedes only ADR-0005's absolute zero-tool side-chat boundary. ADR-0005 remains the active authority for persistent overlay UX, per-mode thread behavior, custom entry persistence, reset handling, context filtering, and the no per-side-chat model/thinking override rule.

Approved tools/skills do not authorize parent prompt/history inheritance. Capability profiles are about runtime capabilities, not parent state sharing.

## Status History

- 2026-05-01: Accepted for issue #57; replaces the zero-tool side-chat rule with an explicit guarded capability-profile boundary while preserving ADR-0005 overlay and isolation semantics.
