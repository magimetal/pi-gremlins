# PRD-0004: Pi Gremlins Side-Chat Absorption and pi-gizmo Deprecation

- **Status:** Active
- **Date:** 2026-04-29
- **Author:** Magi Metal
- **Related:** `extensions/pi-gremlins`, `extensions/pi-gizmo`, `README.md`, `CHANGELOG.md`, GitHub issue [#47](https://github.com/magimetal/pi-gremlins/issues/47), [ADR-0002](../adr/0002-in-process-sdk-based-gremlin-runtime.md), [ADR-0003](../adr/0003-unified-agent-discovery-and-primary-agent-prompt-injection-in-pi-gremlins.md)
- **Supersedes:** None

## Problem Statement

`pi-gizmo` ships a side-chat experience for parent-session conversational excursions, but it does so through a sprawling nine-command surface (`gizmo:new`, `gizmo:recap`, `gizmo:inject`, `gizmo:summarize`, `gizmo:model`, `gizmo:thinking`, `gizmo:clear`, plus chat send/list verbs) and a parallel runtime built around nested Pi CLI subprocesses, temp prompt files, chain mode, and a popup viewer — exactly the runtime shape that ADR-0002 collapsed when `pi-gremlins` adopted the in-process SDK gremlin runtime. The result is two packages with overlapping discovery, divergent UX, and the maintenance burden of a runtime path the project has formally moved away from.

Issue #47 proposes folding side-chat into `pi-gremlins` as exactly two commands — `/gremlins:chat` (parent context attached) and `/gremlins:tangent` (clean child session) — built fresh inside `extensions/pi-gremlins/` on the existing gremlin session factory, then deprecating `pi-gizmo`. This PRD captures the user-facing scope, locks design answers to Q1–Q5, and defines acceptance criteria for both the new commands and the `pi-gizmo` deprecation deliverables. Now is the right time because `pi-gremlins` already owns gremlin delegation (PRD-0002) and primary-agent selection (PRD-0003); absorbing side-chat consolidates the agent-orchestration surface into a single package and lets us retire the legacy runtime without stranding active workflows.

## Product Goals

- Replace the nine-command `pi-gizmo` side-chat surface with two intentional commands inside `pi-gremlins`.
- Reuse the `pi-gremlins` in-process SDK session factory rather than reviving the legacy nested-CLI runtime.
- Keep the v1 side-chat experience scoped to pure conversation — no tools, no workspace mutation risk.
- Give `pi-gizmo` users a clear 1:N migration table from old commands to new behavior.
- Deprecate `pi-gizmo` only after equivalent `pi-gremlins` side-chat behavior ships.

## User Stories

- As an operator mid-task, I want to run `/gremlins:chat <prompt>` so that I can ask a clarifying question with my parent session's context attached without spawning a delegated gremlin.
- As an operator exploring an unrelated idea, I want to run `/gremlins:tangent <prompt>` so that I can have a clean side conversation that does not inherit my parent transcript.
- As a `pi-gizmo` user, I want a documented mapping from old gizmo commands to the new two-command surface so that I know what behavior I keep, what I lose, and what is deferred.
- As a cautious operator, I want side-chat to have no tool access in v1 so that an exploratory conversation cannot mutate my workspace.
- As a maintainer, I want side-chat built on the existing gremlin session factory so that we do not maintain a second runtime path or revive patterns ADR-0002 retired.
- As a package user, I want `pi-gizmo` deprecation guidance only after the replacement lands so that I do not lose side-chat capability mid-migration.

## Scope

### In Scope

- Add `/gremlins:chat <prompt>` command to `pi-gremlins`: starts (or continues, see Q1) a side conversation with the parent session's context attached as input.
- Add `/gremlins:tangent <prompt>` command to `pi-gremlins`: starts a clean child session with no parent transcript attached.
- Build both commands fresh inside `extensions/pi-gremlins/` using the existing `gremlin-session-factory` patterns and the in-process SDK runtime established by ADR-0002.
- Render side-chat output inline in the parent transcript (Q2 decision below).
- Provide a fresh side-thread per `/gremlins:chat` and `/gremlins:tangent` invocation in v1 (Q1 decision below).
- Operate the side-thread as a pure conversation surface with zero tool access in v1 (Q4 decision below).
- Document side-chat behavior, command UX, isolation guarantees, and the `pi-gizmo` migration mapping in `pi-gremlins` README.
- After equivalent behavior ships, update `pi-gizmo` documentation to mark the package deprecated and point users to `/gremlins:chat` and `/gremlins:tangent`.
- Migration mapping table (1:N) from each retired `pi-gizmo` command to its new behavior or out-of-scope status.
- Bun test coverage for the two commands, parent-context attachment behavior, clean-session behavior, fresh-thread-per-invocation behavior, and absence of tool access.

### Out of Scope / Non-Goals

- **Thread persistence across invocations** — every invocation starts a fresh side-thread in v1 (Q1).
- **Overlay/popup UI for side-chat** — inline rendering only in v1; an overlay surface may be revisited via a future ADR if usage demands it (Q2).
- **Inject/handoff between side-thread and parent** — users can copy/paste manually; revisit after v1 (Q3).
- **Tool access inside the side-thread** — pure conversation only in v1 (Q4); no workspace, file, or shell tools.
- **Porting `pi-gizmo` source code** — rebuild inside `pi-gremlins` using existing factory patterns (Q5); do not revive nested Pi CLI subprocesses, temp prompt files, chain mode, or the popup viewer.
- **Per-side-thread model overrides** (replacement for `gizmo:model`).
- **Per-side-thread thinking-budget overrides** (replacement for `gizmo:thinking`).
- **Recap/summarize commands** (replacements for `gizmo:recap` and `gizmo:summarize`).
- **Manual context-injection commands** (replacement for `gizmo:inject`).
- **Side-thread clear command** (replacement for `gizmo:clear`) — fresh-per-invocation makes this redundant.
- **Reviving any retired `pi-gizmo` runtime patterns** (nested Pi CLI subprocess runtime, temp prompt files, chain mode, popup viewer).
- **Deprecating or removing `pi-gizmo`** before equivalent `/gremlins:chat` and `/gremlins:tangent` behavior ships in `pi-gremlins`.
- **Changes to gremlin delegation tool schema or primary-agent selection behavior** established by PRD-0002 and PRD-0003.

## Design Decisions (Q1–Q5)

These answers are normative for v1 and drive the acceptance criteria below.

- **Q1 — Thread persistence: FRESH per invocation.** Each `/gremlins:chat` and `/gremlins:tangent` invocation starts a new side-thread. Rationale: matches `pi-gremlins`'s simplicity bias, avoids reviving the kind of custom session entries that ADR-0002 collapsed, and removes a class of state-reconstruction bugs from the v1 surface. Persistence may be reconsidered in a follow-up PRD if real usage demands continuity.
- **Q2 — Overlay vs inline: INLINE in v1.** Side-chat output renders inline in the parent transcript, consistent with the current `pi-gremlins` surface. An overlay/popup UI is explicitly deferred and would require a future ADR before adoption.
- **Q3 — Inject/handoff: OUT OF SCOPE for v1.** Users transfer information between side-thread and parent by copy/paste. Revisit after v1 ships.
- **Q4 — Tool access in side-thread: NONE in v1.** Side-chat is a pure conversation surface. No workspace tools, no file tools, no shell. This eliminates the risk of a side-thread mutating the workspace and aligns with the issue's stated reduction goal.
- **Q5 — Rebuild vs port: REBUILD inside `pi-gremlins`.** Implement on top of `gremlin-session-factory` patterns and the in-process SDK runtime per ADR-0002. Do not port `pi-gizmo` source. Per AGENTS.md, do not revive the nested Pi CLI subprocess runtime, temp prompt files, chain mode, or the popup viewer.

## Acceptance Criteria

### Issue #47 baseline

- [ ] `/gremlins:chat <prompt>` is registered by `pi-gremlins` and runs a side conversation with the parent session's context attached as input.
- [ ] `/gremlins:tangent <prompt>` is registered by `pi-gremlins` and runs a clean child session with no parent transcript attached.
- [ ] No new commands beyond `/gremlins:chat` and `/gremlins:tangent` are added for side-chat in v1.
- [ ] Implementation lives entirely under `extensions/pi-gremlins/` and reuses the existing gremlin session factory.
- [ ] No `pi-gizmo` source is ported or imported by `pi-gremlins`.
- [ ] `pi-gizmo` is marked deprecated in its own README/changelog after the replacement ships, with users pointed to `/gremlins:chat` and `/gremlins:tangent`.

### Q1–Q5 decisions

- [ ] Each `/gremlins:chat` invocation creates a new side-thread; no state from a prior `/gremlins:chat` invocation leaks into the next (Q1).
- [ ] Each `/gremlins:tangent` invocation creates a new clean child session; no state from a prior tangent leaks into the next (Q1).
- [ ] No custom session entry type is introduced to persist side-thread history across invocations in v1 (Q1).
- [ ] Side-chat output is rendered inline in the parent transcript; no overlay/popup surface is introduced (Q2).
- [ ] No inject/handoff command is exposed in v1; documentation states copy/paste is the supported workflow until a future PRD addresses handoff (Q3).
- [ ] The side-thread runtime exposes zero tools to the SDK call: no workspace, file, or shell tools are made available in either `/gremlins:chat` or `/gremlins:tangent` (Q4).
- [ ] `/gremlins:chat` attaches parent-session context as input only; the parent transcript is not handed to the side-thread as a tool surface (Q4).
- [ ] Side-chat is implemented on the existing `gremlin-session-factory` and the in-process SDK runtime per ADR-0002; no nested Pi CLI subprocess, temp prompt file, chain mode, or popup viewer is introduced (Q5).

### `pi-gizmo` deprecation deliverables

- [ ] `pi-gremlins` README documents `/gremlins:chat` and `/gremlins:tangent`, the fresh-per-invocation behavior, the inline rendering choice, and the no-tools guarantee.
- [ ] `pi-gremlins` README includes a 1:N migration table from each retired `pi-gizmo` command (`gizmo:new`, `gizmo:recap`, `gizmo:inject`, `gizmo:summarize`, `gizmo:model`, `gizmo:thinking`, `gizmo:clear`, plus chat send/list verbs) to its replacement behavior or explicit out-of-scope status.
- [ ] CHANGELOG entry references PRD-0004 and issue #47 for the side-chat absorption.
- [ ] `pi-gizmo` README/changelog is updated to mark the package deprecated and point users to `pi-gremlins` only after `/gremlins:chat` and `/gremlins:tangent` ship.
- [ ] Migration guidance tells users not to run both `pi-gizmo` and `pi-gremlins` side-chat commands concurrently if conflicting command names or shortcuts exist.
- [ ] Bun coverage exists for: `/gremlins:chat` parent-context attachment, `/gremlins:tangent` clean-session behavior, fresh-per-invocation isolation between consecutive calls, and absence of tool access from the side-thread runtime.

## Technical Surface

- **Commands and extension hooks:** `extensions/pi-gremlins/index.ts` (or extracted modules) for registering `/gremlins:chat` and `/gremlins:tangent`, argument parsing, and inline transcript rendering.
- **Side-thread runtime:** new module under `extensions/pi-gremlins/` built on the existing `gremlin-session-factory` and the in-process SDK runtime; produces a side-thread per invocation and exposes no tools.
- **Parent-context attachment (`/gremlins:chat`):** helper that captures the parent transcript or a defined context slice and passes it to the side-thread as input only — never as a tool or workspace handle.
- **Isolation guarantees:** confirm side-thread invocations cannot reach gremlin tools, primary-agent prompt injection, or workspace mutation paths owned by PRD-0002 / PRD-0003 surfaces.
- **Docs:** `README.md`, `CHANGELOG.md`, and later `pi-gizmo` README/changelog deprecation notes after support ships.
- **Tests:** Bun tests beside the new side-chat modules under `extensions/pi-gremlins/`.
- **Related ADRs:** [ADR-0002](../adr/0002-in-process-sdk-based-gremlin-runtime.md) for the in-process SDK runtime that side-chat must reuse rather than replace; [ADR-0003](../adr/0003-unified-agent-discovery-and-primary-agent-prompt-injection-in-pi-gremlins.md) for the surrounding agent-discovery and primary-agent injection contracts that side-chat must not regress.

## UX Notes

- Both commands take a single free-form prompt argument: `/gremlins:chat <prompt>` and `/gremlins:tangent <prompt>`.
- Side-chat output is rendered inline in the parent transcript with a clear visual delimiter so the user can distinguish side-chat turns from parent-session output, parent-session tool calls, and gremlin delegation output.
- Empty-argument invocation should produce a transcript-visible usage hint rather than starting an empty side-thread.
- Because v1 is fresh-per-invocation, command help/docs must explicitly state that prior side-chat turns do not carry over; this is a deliberate v1 simplification, not a bug.
- The no-tools guarantee should be visible in user-facing docs so operators understand the side-thread cannot read or modify the workspace.
- Migration copy should make clear that `gizmo:model`, `gizmo:thinking`, `gizmo:recap`, `gizmo:summarize`, `gizmo:inject`, `gizmo:clear`, and `gizmo:new` have no v1 replacement, and that fresh-per-invocation makes `gizmo:new` and `gizmo:clear` structurally unnecessary.

## Risks

- **Regression of existing `pi-gremlins` flows.** Adding side-chat must not perturb the gremlin delegation tool schema (PRD-0002) or primary-agent selection/prompt injection (PRD-0003). Mitigation: reuse the session factory without changing its public shape; cover existing flows in CI before and after the change.
- **Isolation breach.** A misconfigured side-thread could inherit gremlin tools, primary-agent prompt injection, or workspace tools. Mitigation: explicit no-tools assertion in the side-thread runtime and a Bun test that fails if any tool surface is reachable.
- **Inline rendering UX for multi-turn conversation.** Inline-only side-chat may feel cramped for longer exchanges and could be confused with parent-session output. Mitigation: clear visual delimiters and explicit docs; revisit overlay via a future ADR if real usage shows pain.
- **Migration friction for `pi-gizmo` power users.** Users relying on `gizmo:model`, `gizmo:thinking`, `gizmo:recap`, `gizmo:summarize`, or `gizmo:inject` lose those affordances. Mitigation: explicit 1:N migration table calling each retired command out by name, with rationale and any planned follow-ups.
- **Dual-package conflict during deprecation.** If both `pi-gizmo` and `pi-gremlins` are installed, command/shortcut overlap could confuse users. Mitigation: deprecation notes tell users to migrate before relying on `/gremlins:chat` and `/gremlins:tangent`, mirroring the `pi-mohawk` deprecation pattern in PRD-0003.
- **Scope creep back toward the nine-command surface.** Pressure to re-add recap/inject/model/thinking/clear after v1 lands. Mitigation: this PRD names each retired command as explicitly out of scope; future additions require a new PRD.

## Open Questions

- Should `/gremlins:chat` attach the full parent transcript or a bounded recent window in v1, and how is that boundary defined?
- What exact visual delimiter should mark side-chat turns inline so they are unambiguous against parent output, gremlin delegation output, and primary-agent prompt blocks?
- Should empty-argument `/gremlins:chat` and `/gremlins:tangent` print a usage hint, open a picker (where UI supports it), or both?
- After v1 ships, what real usage signal would justify revisiting Q1 (persistence), Q2 (overlay), or Q3 (inject/handoff) in a follow-up PRD?
- Should the `pi-gizmo` deprecation note set a removal target (version/date), or leave the package in deprecated-but-installed status indefinitely?

## Revision History

- 2026-04-29: Draft created for GitHub issue #47 product scope.
- 2026-04-29: Promoted Draft → Active. PLAN_REVIEW PASS; commit-to-build per orchestrator Step 5.
