# ADR-0004: Side-Chat Absorption from pi-gizmo into pi-gremlins

- **Status:** Accepted
- **Date:** 2026-04-29
- **Decision Maker:** magimetal
- **Related:**
  - GitHub issue #47 — "Absorb pi-gizmo side-chat into pi-gremlins"
  - PRD-0004 — `docs/prd/0004-pi-gremlins-side-chat-absorption-and-pi-gizmo-deprecation.md`
  - ADR-0001 — Semantic Presentation Architecture (superseded by ADR-0002, cited for inline-rendering lineage)
  - ADR-0002 — In-Process SDK-Based Gremlin Runtime
  - ADR-0003 — Unified Agent Discovery and Primary-Agent Prompt Injection
  - `AGENTS.md` anti-patterns list (popup viewer, nested runtimes, transcript leaks)
- **Supersedes:** n/a

## Context

pi-gizmo today ships a "side-chat" feature: a slash-command-driven secondary
conversation thread surfaced in an overlay/popup viewer, backed by a custom
session-entry persistence layer and a nested runtime distinct from the host
agent. Issue #47 asks us to absorb that capability into pi-gremlins so the
host project owns one rendering surface, one runtime, and one agent-discovery
contract end-to-end.

Three prior ADRs constrain the absorption:

- **ADR-0001 / ADR-0002** established that pi-gremlins renders agent output
  through a single semantic-presentation pipeline driven by the in-process SDK
  runtime. Reviving an overlay/popup viewer would re-introduce a rendering
  surface that ADR-0002 explicitly collapsed and that `AGENTS.md` lists as the
  "popup viewer" anti-pattern.
- **ADR-0003** locked the isolation boundary used by `buildGremlinSessionConfig`
  in `extensions/pi-gremlins/gremlin-session-factory.ts`: child sessions must
  not inherit the parent's extensions, prompts, themes, skills, `AGENTS.md`
  files, primary-agent markdown, or transcript content unless explicitly
  seeded.

PRD-0004 (sibling, in-progress) captures the product surface (`/gremlins:chat`,
`/gremlins:tangent`) and user expectations. This ADR records the architectural
commitments that make that surface implementable inside pi-gremlins without
regressing prior decisions, and defines the deprecation boundary toward
pi-gizmo.

## Decision Drivers

- Preserve the single-renderer invariant from ADR-0001/0002 (no popup viewer).
- Preserve the isolation contract from ADR-0003 (no parent-context bleed).
- Avoid re-introducing nested runtimes or bespoke persistence stores.
- Keep the v1 surface minimal so future demand, not speculation, drives feature
  expansion.
- Provide a clean cross-package deprecation story for pi-gizmo consumers.

## Options Considered

### Option A: Port pi-gizmo wholesale into pi-gremlins

- Pros: Fastest path to feature parity; preserves existing pi-gizmo UX.
- Cons: Drags the overlay viewer, custom persistence, and nested runtime back
  into pi-gremlins — directly violates ADR-0002 and the `AGENTS.md` popup-viewer
  and nested-runtime anti-patterns. Rejected.

### Option B: Revive an overlay/modal rendering surface for side-chat only

- Pros: Visually separates side-chat from primary transcript.
- Cons: Two rendering surfaces to maintain; contradicts ADR-0001/0002's
  semantic-presentation consolidation; matches the documented "popup viewer"
  anti-pattern. Rejected.

### Option C: Persist side-chat threads across invocations

- Pros: Lets users resume tangents.
- Cons: Requires a new persistence model (the exact shape ADR-0002 dismantled
  in pi-gizmo); no demand evidence in issue #47; expands the v1 surface area.
  Rejected for v1; revisitable via future ADR.

### Option D: Allow tool registration on side-chat sessions in v1

- Pros: Side-chat could perform real work, not just conversation.
- Cons: Multiplies the security/isolation surface (which tools, with what
  permissions, against which working directory) with no concrete v1 use case.
  Rejected for v1; revisitable via future ADR.

### Option E (chosen): Inline-rendered, ephemeral, isolation-respecting side-chat inside pi-gremlins

- Pros: Reuses existing renderer, runtime, and isolation primitives; no new
  persistence; no new rendering surface; minimal v1 footprint; clean
  deprecation story for pi-gizmo.
- Cons: No thread resumption; no tool use; loses pi-gizmo's overlay UX.

## Decision

Chosen: **Option E — Inline-rendered, ephemeral, isolation-respecting
side-chat inside pi-gremlins.**

The decision is composed of the following commitments (D1–D8):

### D1 — Rendering surface: inline only

Side-chat output renders **inline** through pi-gremlins' existing renderer
hooks (the same semantic-presentation pipeline established by ADR-0001 and
consolidated under ADR-0002). No overlay, no modal, no popup viewer. This
explicitly closes the door on reviving pi-gizmo's overlay surface and aligns
with the `AGENTS.md` "popup viewer" anti-pattern entry.

### D2 — Thread model: ephemeral, per-invocation

Each `/gremlins:chat` and `/gremlins:tangent` invocation creates a **new
in-memory side-chat session**. There is **no persistence** of side-chat
threads across invocations. pi-gizmo's custom session-entry persistence is not
ported. This aligns with ADR-0002's collapse of nested runtimes and avoids
re-introducing a bespoke storage contract.

### D3 — Context seeding and isolation

- `/gremlins:chat` seeds the child session with a **snapshot of the parent
  transcript at invocation time**, passed through the same isolation boundary
  used by `buildGremlinSessionConfig`.
- `/gremlins:tangent` seeds the child session with **no parent context**.

Both modes inherit ADR-0003's isolation guarantees in full: no parent
extensions, prompts, themes, skills, `AGENTS.md` files, primary-agent
markdown, or transcript content leaks beyond the explicit chat-mode seed.

### D4 — Tool access: zero tools in v1

v1 side-chat sessions register **zero tools**. Side-chat is pure conversation.
A future ADR may revisit if explicit demand emerges; until then, the surface
stays narrow.

### D5 — Code locus: inside `extensions/pi-gremlins/`

New modules (e.g., `side-chat-command.ts`, `side-chat-session-factory.ts`)
live under `extensions/pi-gremlins/` and **reuse the existing
`gremlin-session-factory` primitives**. No new package. No nested runtime.
This keeps the absorbed feature on the same runtime and isolation rails as the
rest of pi-gremlins.

### D6 — Slash command registration

Two commands are registered through the existing pi-extension `registerCommand`
API (the same path used for tool registration today):

- `/gremlins:chat <question>` — required argument; seeds with parent
  transcript.
- `/gremlins:tangent <question>` — required argument; no parent context.

Empty arguments print usage rather than starting a session.

### D7 — Deprecation boundary for pi-gizmo

pi-gizmo will receive a final release marking the package **deprecated** and
pointing users to pi-gremlins. pi-gremlins ships a migration mapping in its
README and CHANGELOG. This ADR scopes the deprecation as **cross-package
coordination**, not a pi-gremlins runtime change — pi-gremlins itself does not
import, depend on, or shim pi-gizmo.

### D8 — Forward compatibility: explicitly deferred items

The following are **explicitly deferred** out of v1. Each is a candidate for a
future ADR, triggered only by concrete demand evidence:

- **Q1** Persistence / thread resumption across invocations.
- **Q2** Overlay / modal rendering surface for side-chat.
- **Q3** Inject / handoff semantics between primary and side-chat sessions.
- **Q4** Tool access inside side-chat sessions.
- **Q5** Per-side-chat model and thinking-mode overrides.

## Consequences

- **Positive — Rendering surface (D1):** One renderer, one surface; no
  regression of ADR-0001/0002; no new viewer code paths to maintain.
- **Positive — Thread model (D2):** No new persistence shape; failure modes
  reduced to in-memory lifetime; trivially testable.
- **Positive — Isolation (D3):** Reuses ADR-0003's isolation boundary, so the
  isolation invariant is centralised in `buildGremlinSessionConfig`; no
  parallel boundary to drift.
- **Positive — Tools (D4):** Smallest possible v1 attack surface; no
  permissioning model required upfront.
- **Positive — Code locus (D5):** Side-chat is discoverable next to existing
  factory primitives; future maintainers see one runtime, not two.
- **Positive — Commands (D6):** Reuses the established extension command API;
  no new registration mechanism.
- **Positive — Deprecation (D7):** Single source of truth for users; pi-gizmo
  exits cleanly without pi-gremlins inheriting its internals.
- **Negative — Thread model (D2):** Users lose pi-gizmo's resumable threads;
  every invocation starts fresh.
- **Negative — Tools (D4):** Side-chat cannot perform actions; conversation
  only.
- **Negative — Rendering (D1):** Inline rendering interleaves side-chat output
  with primary transcript; users who relied on visual separation in the
  overlay must adapt.
- **Negative — Migration cost (D7):** pi-gizmo users must update workflows;
  migration mapping must stay accurate across the deprecation window.
- **Follow-on constraints:**
  - Any future revisit of Q1–Q5 must clear ADR-0001/0002 (no popup viewer)
    and ADR-0003 (isolation) before landing.
  - Side-chat factory must remain a *consumer* of `gremlin-session-factory`
    primitives, not a fork.
  - pi-gremlins must not take a runtime dependency on pi-gizmo at any point
    in the deprecation window.

## Implementation Impact

- **extensions/pi-gremlins:** New `side-chat-command.ts` and
  `side-chat-session-factory.ts` (or equivalents) reusing
  `gremlin-session-factory.ts`. `index.ts` registers `/gremlins:chat` and
  `/gremlins:tangent` via the existing `registerCommand` API.
- **Renderer:** No structural changes; side-chat output flows through existing
  semantic-presentation hooks.
- **Persistence / config:** None. No new on-disk state.
- **pi-gizmo (separate repo):** Final deprecation release; package marked
  deprecated; README points to pi-gremlins.
- **pi-gremlins README / CHANGELOG:** Migration mapping from pi-gizmo
  side-chat to `/gremlins:chat` and `/gremlins:tangent`; CHANGELOG entry cites
  **ADR-0004** and **PRD-0004**.

## Verification

- **Automated:**
  - Tests MUST assert the ADR-0003 isolation contract for side-chat sessions:
    no parent extensions, prompts, themes, skills, `AGENTS.md` files,
    primary-agent markdown, or transcript content leaks beyond the explicit
    `/gremlins:chat` seed.
  - Tests MUST assert that `/gremlins:tangent` seeds with no parent context.
  - Tests MUST assert that v1 side-chat sessions register zero tools.
  - Tests MUST assert that empty-argument invocations print usage instead of
    starting a session.
- **Compliance hooks:**
  - CHANGELOG entry for the absorbing release MUST cite **ADR-0004** and
    **PRD-0004**.
  - README migration section MUST reference this ADR.
- **Manual:**
  - Run `/gremlins:chat <q>` after a non-trivial primary turn; confirm the
    seeded transcript snapshot is present and rendered inline.
  - Run `/gremlins:tangent <q>` from the same session; confirm no parent
    context is visible to the child agent.

## Notes

- The `Proposed` status reflects that PRD-0004 is being authored in parallel
  and that the absorbing implementation has not yet landed. Promote to
  `Accepted` once both the PRD is finalised and the implementation is merged.
- Revisit triggers for Q1–Q5 (D8): concrete user demand, a security-driven
  need for tool access, or a UX failure attributable to inline rendering.

## Status History

- 2026-04-29: Proposed
- 2026-04-29: Updated PRD cross-link.
- 2026-04-29: Accepted; implementation matches D1-D8 (PR #48, commit ab2c856).
