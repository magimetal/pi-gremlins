# Issue 39 Fix Plan: Merge Primary-Agent Selection into pi-gremlins

## Objective

Fix GitHub issue [#39](https://github.com/magimetal/pi-gremlins/issues/39) by moving `pi-mohawk` primary-agent discovery, selection, session state, status, shortcut, and prompt injection into `pi-gremlins`, then document the migration/deprecation path and open a PR with `Closes #39`.

## Governance Inputs

- PRD: `docs/prd/0003-primary-agent-selection-and-pi-mohawk-deprecation.md` (`Draft` at planning time)
- ADR: `docs/adr/0003-unified-agent-discovery-and-primary-agent-prompt-injection-in-pi-gremlins.md` (`Accepted`)
- Prior architecture still binding: `docs/adr/0002-in-process-sdk-based-gremlin-runtime.md`
- Issue source: `gh issue view 39`
- Pi extension docs consulted for implementation constraints:
  - `/Users/magimetal/.nvm/versions/node/v24.14.0/lib/node_modules/@mariozechner/pi-coding-agent/docs/extensions.md`
  - `/Users/magimetal/.nvm/versions/node/v24.14.0/lib/node_modules/@mariozechner/pi-coding-agent/docs/session.md`
  - `/Users/magimetal/.nvm/versions/node/v24.14.0/lib/node_modules/@mariozechner/pi-coding-agent/docs/keybindings.md`
  - `/Users/magimetal/.nvm/versions/node/v24.14.0/lib/node_modules/@mariozechner/pi-coding-agent/docs/tui.md`

## Key Decisions To Enforce

- Keep package, extension entrypoint, tool name, and schema identity as `pi-gremlins`.
- Do not change public gremlin schema: `gremlins: [{ agent, context, cwd? }]`.
- Add primary-agent support beside existing gremlin delegation, not through the tool schema.
- Use shared role-aware markdown parsing/discovery for `agent_type: primary` and `agent_type: sub-agent`.
- Persist new primary selection entries as `pi-gremlins-primary-agent`.
- Read legacy `pi-mohawk-primary-agent` entries during transition; write only `pi-gremlins-primary-agent`.
- Persist only selected identity: name, source, path. Never persist raw markdown.
- Keep `/mohawk`, `/mohawk <name>`, `/mohawk none`, and `ctrl+shift+m` as compatibility controls unless a hard Pi conflict appears.
- Use status key `pi-gremlins-primary` and visible label `Primary: <name|None>`.
- Delimit injected primary-agent markdown with:
  - `<!-- pi-gremlins primary agent:start -->`
  - `<!-- pi-gremlins primary agent:end -->`
- Strip existing `pi-gremlins` and legacy `pi-mohawk` prompt blocks before appending new primary block.
- Do not reintroduce nested Pi CLI subprocess runtime, chain mode, popup viewer, package discovery, steering, or scope toggles.

## Assumptions

- `pi-mohawk` source remains available at `/Users/magimetal/Dev/pi/pi-mohawk` for reference and test porting.
- Current repo verification commands are authoritative from `package.json`: `npm run typecheck`, `npm test`, `npm run check`.
- `pi.registerCommand`, `pi.registerShortcut`, `ctx.ui.setStatus`, `pi.appendEntry`, `ctx.sessionManager.getBranch()`, and `before_agent_start` are available from Pi extension API.
- PRD-0003 must move from `Draft` to `Active` before runtime implementation begins.

## Implementation Tasks

### 1. Activate PRD scope before code

**What**

- Update `docs/prd/0003-primary-agent-selection-and-pi-mohawk-deprecation.md` status from `Draft` to `Active`.
- Update `docs/prd/README.md` index status for PRD-0003 from `Draft` to `Active`.
- Cross-link PRD to ADR-0003 if current text still says the ADR is pending.

**References**

- `docs/prd/0003-primary-agent-selection-and-pi-mohawk-deprecation.md`
- `docs/prd/README.md`
- `docs/adr/0003-unified-agent-discovery-and-primary-agent-prompt-injection-in-pi-gremlins.md`

**Acceptance criteria**

- PRD-0003 status is `Active`.
- PRD README index shows PRD-0003 as `Active`.
- PRD metadata or Technical Surface references ADR-0003 by path or number, not “pending ADR”.

**Guardrails**

- Do not change PRD scope beyond aligning status and ADR link.
- Do not mark PRD completed until implementation and review pass.

**Verification**

- Read back PRD and PRD README.

### 2. Introduce shared agent definition parsing

**What**

- Extract role-neutral markdown parsing from `gremlin-definition.ts` into a shared helper, for example `extensions/pi-gremlins/agent-definition.ts`.
- Support role-specific loaders:
  - gremlin/sub-agent loader keeps `agent_type: sub-agent` and requires frontmatter `name` as current behavior requires.
  - primary-agent loader accepts only `agent_type: primary` and derives display name from frontmatter `name`, first H1, then filename stem.
- Preserve raw markdown on loaded definitions for later prompt injection.
- Preserve parsed gremlin frontmatter behavior for `description`, `model`, `thinking`, `tools`, and `body`.

**References**

- `extensions/pi-gremlins/gremlin-definition.ts`
- new `extensions/pi-gremlins/agent-definition.ts` if extracted
- possible new `extensions/pi-gremlins/primary-agent-definition.ts`
- `/Users/magimetal/Dev/pi/pi-mohawk/extensions/agent-definition.ts`
- `/Users/magimetal/Dev/pi/pi-mohawk/tests/agent-definition.test.ts`

**Acceptance criteria**

- Existing gremlin parsing output remains compatible for current callers.
- Untyped markdown returns `null` for both roles.
- `agent_type: primary` never parses as gremlin.
- `agent_type: sub-agent` never parses as primary.
- Primary display-name fallback order matches PRD: `name`, first H1, filename stem.
- Raw markdown is available on primary definitions but is not persisted.

**Guardrails**

- Do not accept legacy role aliases such as `sub` or untyped markdown.
- Do not remove current `GremlinDefinition` fields used by runner/session-factory code.
- Do not use `as any`, `@ts-ignore`, or `@ts-expect-error` to hide typing issues.

**Verification**

- Add/port Bun tests for gremlin parsing stability, primary parsing, fallback names, malformed frontmatter, and role crossover rejection.
- Focused command during implementation: `bun test extensions/pi-gremlins/*definition*.test.js`.

### 3. Unify agent directory discovery by role

**What**

- Refactor `gremlin-discovery.ts` scanning/fingerprinting into shared role-aware discovery utilities.
- Keep `createGremlinDiscoveryCache()` as existing gremlin-facing API.
- Add primary discovery API, for example `createPrimaryAgentDiscoveryCache()`.
- Support user agents directory from `path.join(getAgentDir(), "agents")` and nearest project `.pi/agents`.
- Preserve current project-over-user precedence by display name.
- Add primary-agent name resolution that distinguishes exact match, single case-insensitive match, ambiguous case-insensitive matches, and not-found.

**References**

- `extensions/pi-gremlins/gremlin-discovery.ts`
- `extensions/pi-gremlins/gremlin-discovery.test.js`
- possible new `extensions/pi-gremlins/agent-discovery.ts`
- possible new `extensions/pi-gremlins/primary-agent-discovery.ts`
- `/Users/magimetal/Dev/pi/pi-mohawk/extensions/agent-discovery.ts`
- `/Users/magimetal/Dev/pi/pi-mohawk/tests/agent-discovery.test.ts`

**Acceptance criteria**

- Gremlin discovery still returns only `agent_type: sub-agent` definitions.
- Primary discovery returns only `agent_type: primary` definitions.
- Project definition wins over user definition with the same display name.
- Sorted order is deterministic and used by shortcut cycling.
- Primary resolution reports ambiguity without changing state.
- Cache invalidation still responds to directory/file mtime changes and session lifecycle clears.
- Primary symlink behavior follows ADR/PRD final decision; if preserving current gremlin symlink support, document role-specific behavior in tests.

**Guardrails**

- Do not expose primary agents through `resolveGremlinByName`.
- Do not make gremlin discovery more permissive while extracting shared utilities.
- Do not change `pi-gremlins` tool parameters or result shape.

**Verification**

- Port/adapt discovery tests from pi-mohawk into Bun.
- Run focused discovery tests: `bun test extensions/pi-gremlins/gremlin-discovery.test.js extensions/pi-gremlins/*primary*discovery*.test.js`.

### 4. Add primary-agent session state

**What**

- Add a primary-agent state module, for example `extensions/pi-gremlins/primary-agent-state.ts`.
- On `session_start`, reconstruct selected state from `ctx.sessionManager.getBranch()`.
- Read latest valid current-branch custom entry from either:
  - `pi-gremlins-primary-agent`
  - legacy `pi-mohawk-primary-agent`
- On any new selection/change, persist with `pi-gremlins-primary-agent` only.
- Store `None` explicitly so clearing survives branch reconstruction.
- Store minimal identity: selected name, source, file path. Do not store raw markdown.

**References**

- `extensions/pi-gremlins/index.ts`
- new `extensions/pi-gremlins/primary-agent-state.ts`
- `/Users/magimetal/Dev/pi/pi-mohawk/extensions/session-state.ts`
- `/Users/magimetal/Dev/pi/pi-mohawk/tests/session-state.test.ts`
- Pi session docs: `docs/session.md` in pi package

**Acceptance criteria**

- Latest current-branch state wins.
- Explicit `None` reconstructs as no selected primary agent.
- Legacy `pi-mohawk-primary-agent` entry can initialize state.
- New writes always use `pi-gremlins-primary-agent`.
- Raw markdown never appears in persisted custom entry data.
- Missing selected agent can be detected later and reset to `None`.

**Guardrails**

- Do not read abandoned branches via `getEntries()` when branch-specific state is required.
- Do not persist prompt content or whole frontmatter objects.
- Do not leak selection across unrelated new sessions.

**Verification**

- Port session-state tests to Bun.
- Add tests for current-branch precedence, explicit `None`, legacy read, new write type, and no raw markdown persistence.

### 5. Add command, picker/list fallback, shortcut, and status UX

**What**

- In `index.ts` or extracted module, register compatibility command `/mohawk`.
- Support:
  - `/mohawk` -> picker when `ctx.hasUI`; transcript-visible list when no UI.
  - `/mohawk <name>` -> exact or unambiguous case-insensitive select.
  - `/mohawk none` -> clear selected primary.
- Register `ctrl+shift+m` shortcut to cycle `[None, ...sorted primary agents]`.
- Update status after session start and every selection change with key `pi-gremlins-primary` and label `Primary: <name|None>`.
- Use `ctx.ui.select` for picker unless implementation needs a custom TUI list; include `None` as first option.
- Use `pi.sendMessage` or UI notification path for no-UI/fallback feedback, matching Pi extension command behavior.

**References**

- `extensions/pi-gremlins/index.ts`
- possible new `extensions/pi-gremlins/primary-agent-controls.ts`
- possible new `extensions/pi-gremlins/primary-agent-status.ts`
- `/Users/magimetal/Dev/pi/pi-mohawk/extensions/pi-mohawk.ts`
- `/Users/magimetal/Dev/pi/pi-mohawk/tests/pi-mohawk-extension.test.ts`
- Pi docs: `extensions.md`, `keybindings.md`, `tui.md`

**Acceptance criteria**

- Exact command selection works.
- Single case-insensitive command selection works.
- Ambiguous case-insensitive selection leaves current state unchanged and reports exact-case options.
- `/mohawk none` clears and persists `None`.
- No-args command opens picker with UI.
- No-args command without UI emits `Primary agents: None, ...` or equivalent transcript-visible names.
- Shortcut cycles deterministically through `[None, ...sorted primary agents]`.
- Status displays `Primary: None` or `Primary: <name>` after startup and changes.

**Guardrails**

- Do not remove `pi.registerTool(tool as any)` boundary or alter existing tool registration semantics.
- Do not overload gremlin tool invocation with primary selection.
- Do not make `/mohawk` write stale state when discovery fails.

**Verification**

- Port command/shortcut/status tests into Bun.
- Focused test command: `bun test extensions/pi-gremlins/index.*.test.js extensions/pi-gremlins/*primary*control*.test.js`.

### 6. Add prompt injection hook

**What**

- Register `before_agent_start` handler from `pi-gremlins` extension.
- If selected primary is `None`, return no prompt change after stripping nothing from current prompt.
- If selected primary exists, reload/resolve current definition by identity, strip old `pi-gremlins` and legacy `pi-mohawk` primary blocks, append selected raw markdown inside `pi-gremlins` delimiters, and return `{ systemPrompt }`.
- If selected primary no longer exists, persist `None`, update status, warn user, and leave prompt unchanged except legacy duplicate block stripping only if implementation can do so safely.
- Keep helper functions isolated, for example `extensions/pi-gremlins/primary-agent-prompt.ts`.

**References**

- `extensions/pi-gremlins/index.ts`
- `extensions/pi-gremlins/gremlin-prompt.ts` for parent system prompt snapshot context
- possible new `extensions/pi-gremlins/primary-agent-prompt.ts`
- `/Users/magimetal/Dev/pi/pi-mohawk/tests/prompt-injection.test.ts`
- Pi docs `extensions.md` section `before_agent_start`

**Acceptance criteria**

- `None` selection leaves parent system prompt unchanged.
- Selected primary appends raw markdown exactly once inside `pi-gremlins` delimiters.
- Repeated injection does not duplicate blocks.
- Legacy `pi-mohawk` blocks are stripped to prevent double injection.
- Missing selected agent resets state to `None`, warns user, and avoids injecting stale markdown.
- Sub-agent markdown can never enter primary injection path.
- Existing gremlin child prompt capture through `ctx.getSystemPrompt()` remains intact.

**Guardrails**

- Do not mutate provider payloads directly through `before_provider_request` for this feature.
- Do not inject raw markdown from untyped files or `agent_type: sub-agent` files.
- Do not store injected markdown in session custom entries.

**Verification**

- Port prompt-injection tests to Bun.
- Add focused test for `before_agent_start` behavior in extension-level harness.
- Manual post-implementation check: select primary, send prompt, confirm primary behavior affects parent; summon gremlin and confirm `pi-gremlins` tool behavior still works.

### 7. Update docs, changelog, and migration guidance

**What**

- Update `README.md` to document both roles:
  - `agent_type: primary` controls parent-session behavior.
  - `agent_type: sub-agent` remains gremlin delegation.
- Document discovery roots, precedence, commands, shortcut, status label, session scope, prompt injection block behavior at user level, and migration/deprecation guidance from `pi-mohawk`.
- Warn users not to run both `pi-mohawk` and updated `pi-gremlins` after migration because controls/hooks can conflict.
- Update `CHANGELOG.md` under Unreleased with issue #39, PRD-0003, ADR-0003, and high-level behavior.
- If current workflow includes editing the separate pi-mohawk repo, do it only after equivalent pi-gremlins behavior is implemented and verified; otherwise leave a follow-up note in PR body.

**References**

- `README.md`
- `CHANGELOG.md`
- `docs/prd/0003-primary-agent-selection-and-pi-mohawk-deprecation.md`
- `docs/adr/0003-unified-agent-discovery-and-primary-agent-prompt-injection-in-pi-gremlins.md`
- `/Users/magimetal/Dev/pi/pi-mohawk/README.md` only if explicitly in implementation scope
- `/Users/magimetal/Dev/pi/pi-mohawk/CHANGELOG.md` only if explicitly in implementation scope

**Acceptance criteria**

- README accurately matches implemented command names, shortcut, status key/label, role filters, and migration behavior.
- README does not imply primary agents can be summoned as gremlins or vice versa.
- CHANGELOG cites PRD-0003 and ADR-0003.
- Docs preserve machine-facing `pi-gremlins` identifiers.
- Any pi-mohawk deprecation docs happen only after pi-gremlins equivalent behavior ships.

**Guardrails**

- Do not tell users to uninstall `pi-mohawk` before support is in pi-gremlins.
- Do not rebrand package/tool/schema keys to `Gremlins🧌`.
- Do not document behavior not covered by tests or implementation.

**Verification**

- Read back README and CHANGELOG.
- Search docs for command/status/delimiter strings and confirm consistency with code.

### 8. Full verification and dead-code cleanup

**What**

- Run focused tests during phases, then full repo verification.
- Check TypeScript, Bun tests, and combined check.
- Remove unused imports, unused exports, obsolete helper files, and copied pi-mohawk leftovers not intentionally retained as compatibility strings.
- Confirm no primary-agent/sub-agent role crossover.

**References**

- `package.json`
- `extensions/pi-gremlins/*.ts`
- `extensions/pi-gremlins/*.test.js`
- `README.md`
- `CHANGELOG.md`

**Acceptance criteria**

- `npm run typecheck` passes.
- `npm test` passes.
- `npm run check` passes.
- Focused primary-agent tests pass.
- No unused imports/exports/files remain from implementation.
- `rg "agent_type: primary|agent_type: sub-agent|pi-mohawk|mohawk|pi-gremlins-primary-agent|before_agent_start" extensions README.md CHANGELOG.md docs` shows only intentional references.
- Public gremlin contract remains unchanged.
- PRD-0003 acceptance criteria are traceable to implementation/tests.

**Guardrails**

- Do not run broad formatters that churn unrelated files.
- Do not edit generated `AGENTS.md` files.
- Do not modify `node_modules`.
- Do not hide verification failures; fix or report blockers.

**Verification commands**

```bash
npm run typecheck
npm test
npm run check
rg "agent_type: primary|agent_type: sub-agent|pi-mohawk|mohawk|pi-gremlins-primary-agent|before_agent_start" extensions README.md CHANGELOG.md docs
```

### 9. Complete PRD lifecycle and PR workflow

**What**

- After implementation review passes, update PRD-0003 status to `Completed` and add Revision History entry summarizing delivered behavior.
- Update `docs/prd/README.md` PRD-0003 status to `Completed`.
- Verify ADR-0003 still matches implementation; if implementation deviated materially, update/supersede ADR before PR.
- Commit on current branch using existing commit style.
- Push current branch.
- Create GitHub PR with title referencing issue #39 and body containing `Closes #39`.

**References**

- `docs/prd/0003-primary-agent-selection-and-pi-mohawk-deprecation.md`
- `docs/prd/README.md`
- `docs/adr/0003-unified-agent-discovery-and-primary-agent-prompt-injection-in-pi-gremlins.md`
- `CHANGELOG.md`
- `git log --oneline -5` for commit style
- `gh pr create`

**Acceptance criteria**

- PRD-0003 is `Completed` only after code/docs/tests pass review.
- ADR-0003 decision remains accurate or is updated/superseded.
- Commit includes runtime, tests, docs, changelog, and governance updates.
- Branch is pushed.
- PR exists and includes `Closes #39`.

**Guardrails**

- Do not commit before verification evidence exists.
- Do not mark PRD completed before implementation acceptance criteria pass.
- Do not create PR without linking `Closes #39`.

**Verification**

```bash
git status --short
git log --oneline -5
gh pr create --fill --body-file <prepared-body-with-Closes-39>
```

## Verification Matrix

| Area | Required evidence |
| --- | --- |
| Definition parsing | Focused Bun tests for role filters, primary fallback names, malformed/untyped ignored |
| Discovery | Focused Bun tests for user/project precedence, role separation, cache invalidation, primary name resolution |
| Session state | Focused Bun tests for current branch reconstruction, legacy read, new write type, explicit None, no raw markdown persistence |
| Command/status/shortcut | Extension-level Bun tests for `/mohawk`, no-UI fallback, picker path, `ctrl+shift+m`, `Primary: ...` |
| Prompt injection | Bun tests for delimiter append, duplicate stripping, legacy stripping, missing selected reset, `None` no-op |
| Existing gremlin contract | Existing `npm test`, schema tests, execute/render tests, plus no schema changes |
| Docs | Readback README, CHANGELOG, PRD/ADR links; string consistency search |
| Full repo | `npm run typecheck`, `npm test`, `npm run check` |
| Dead code | No unused imports/exports/files; intentional references only from `rg` sweep |
| GitHub workflow | Commit, push, PR with `Closes #39` |

## Risks / Unknowns

- **Hook ordering risk:** `before_agent_start` prompt changes are chained by extension load order. Test helper should assert handler return value; manual runtime validation should confirm observed parent prompt behavior.
- **Dual-package conflict risk:** Users running old `pi-mohawk` and new `pi-gremlins` may get duplicate commands/status/hooks. README and PR body must warn about this after migration support lands.
- **Shortcut conflict risk:** `ctrl+shift+m` may conflict with user/system terminal behavior or future Pi bindings. Keep compatibility unless implementation finds a hard conflict; document any deviation.
- **Symlink policy risk:** Current gremlin discovery accepts symlinks, pi-mohawk primary discovery ignored symlinks. Preserve existing gremlin behavior unless PRD/ADR explicitly changes it; test primary behavior chosen by implementation.
- **Cross-repo deprecation risk:** Editing `/Users/magimetal/Dev/pi/pi-mohawk` is outside current repo. If PR scope cannot include it, document as follow-up instead of silently modifying external repo.

## Plan Self-Review

- References PRD-0003 and ADR-0003: yes.
- Avoids code implementation during planning: yes.
- Includes concrete files to inspect/change: yes.
- Includes test, typecheck, full check, dead-code, changelog, commit, push, PR steps: yes.
- Preserves existing `pi-gremlins` v1 tool contract: yes.
- Enforces ADR-0002 runtime guardrails: yes.
