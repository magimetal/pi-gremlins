# pi-gremlins Reliability Audit Repair Plan

## Objective
Repair all listed reliability audit findings in `extensions/pi-gremlins` with minimal, focused runtime and test changes while keeping the public tool schema stable.

## Context and Constraints
- Runtime source: `extensions/pi-gremlins/`.
- Public input schema must remain `gremlins: [{ intent, agent, context, cwd? }]`.
- Do not move the extension entry from `./extensions/pi-gremlins`.
- Do not reintroduce subprocess execution, temporary prompt files, chain mode, popup viewer, steering commands, package discovery, or scope toggles.
- Keep `registerTool(tool as any)` localized to `extensions/pi-gremlins/index.ts`.
- Tests are Bun JS harness tests beside TS runtime files.
- Verification commands: `npm test`, `npm run typecheck`.

## Ordered Tasks

### 1. Add failing regression tests for renderer cache collision
**What**
- Prove `renderGremlinInvocationText()` does not reuse stale output when two different invocations share the same top-level `details.revision` and counts.

**References**
- `extensions/pi-gremlins/gremlin-rendering.ts`
- `extensions/pi-gremlins/gremlin-rendering.test.js`
- `extensions/pi-gremlins/gremlin-render-components.ts` for existing entry cache key behavior.

**Acceptance criteria**
- A new test renders invocation A and invocation B with identical `requestedCount`, status counts, `revision`, width, and expanded state, but different gremlin identity/content.
- The second render contains invocation B content and does not contain invocation A content.
- Include both collapsed mode and, if practical without duplicating too much fixture setup, expanded mode.

**Guardrails**
- Do not disable caching wholesale unless the repair proves targeted caching cannot be made safe.
- Do not key only by `details.revision`; repeated revision values across independent invocations are allowed.
- Preserve render output format.

**Verification**
- Initial bug-proof command after adding the test only: `npm test -- extensions/pi-gremlins/gremlin-rendering.test.js` should fail for the stale-cache assertion.

### 2. Fix renderer cache key uniqueness
**What**
- Update `createRenderCacheKey()` / `getDetailsRevisionKey()` so full-invocation render cache keys include enough gremlin content identity to distinguish separate invocations even when `details.revision` repeats.

**References**
- `extensions/pi-gremlins/gremlin-rendering.ts`
- `extensions/pi-gremlins/gremlin-render-components.ts`
- `extensions/pi-gremlins/gremlin-rendering.test.js`

**Acceptance criteria**
- The regression test from Task 1 passes.
- Existing rendering tests still pass.
- Cache remains bounded by `RENDER_CACHE_LIMIT` and segment cache remains bounded by `RENDER_SEGMENT_CACHE_LIMIT`.

**Guardrails**
- Do not change `GremlinInvocationDetails` public/result shape.
- Do not alter visible text, status labels, gremlin ids, or expand hint.
- Prefer using existing `createEntryCacheKey()` for each entry plus the top-level counts/options.

**Verification**
- `npm test -- extensions/pi-gremlins/gremlin-rendering.test.js`

### 3. Add failing regression tests for corrupt primary-agent settings
**What**
- Prove a corrupt `.pi/settings.json` does not crash primary-agent startup/selection.

**References**
- `extensions/pi-gremlins/primary-agent-persistence.ts`
- `extensions/pi-gremlins/primary-agent.test.js`
- `extensions/pi-gremlins/index.ts`
- `extensions/pi-gremlins/primary-agent-controls.ts` if selection write paths surface persistence errors.

**Acceptance criteria**
- Add a startup test with malformed JSON in project `.pi/settings.json`; `session_start` completes, primary status becomes `Primary: None`, and a warning/diagnostic is visible through existing UI/message plumbing.
- Add a selection test with malformed JSON already present; selecting a valid primary succeeds and rewrites settings to valid JSON containing the selected primary.

**Guardrails**
- Do not discard unrelated valid settings when JSON is readable.
- For unreadable/corrupt JSON, recover deterministically rather than crashing.
- Keep persisted selection shape unchanged.

**Verification**
- Initial bug-proof command after adding tests only: `npm test -- extensions/pi-gremlins/primary-agent.test.js` should fail because malformed JSON currently throws.

### 4. Harden primary-agent persistence and startup diagnostics
**What**
- Make settings reads tolerant of malformed JSON for this extension’s primary-agent selection, and surface a concise diagnostic instead of letting startup crash.

**References**
- `extensions/pi-gremlins/primary-agent-persistence.ts`
- `extensions/pi-gremlins/index.ts`
- `extensions/pi-gremlins/primary-agent.test.js`

**Acceptance criteria**
- Missing settings still reads as `{}`.
- Malformed settings on read returns a safe empty settings object for selection restore.
- Malformed settings on write is replaced with a valid settings object containing the `pi-gremlins.primaryAgent` value.
- `session_start` catches/report persistence read failure if the persistence API returns diagnostics or throws unexpectedly.
- Tests from Task 3 pass.

**Guardrails**
- Do not change namespace/key constants: `pi-gremlins.primaryAgent`.
- Do not add new public commands or schema fields.
- Do not swallow unexpected startup failures outside the settings-read boundary unless a warning is emitted.

**Verification**
- `npm test -- extensions/pi-gremlins/primary-agent.test.js`

### 5. Add failing regression test for request cwd discovery precedence
**What**
- Prove a gremlin request with `cwd` discovers nearest `.pi/agents` from that resolved request cwd, not only from parent `ctx.cwd`.

**References**
- `extensions/pi-gremlins/index.ts`
- `extensions/pi-gremlins/index.execute.test.js`
- `extensions/pi-gremlins/gremlin-discovery.ts`

**Acceptance criteria**
- Create a workspace with parent repo and child/target repo directory containing its own `.pi/agents/researcher.md`.
- Execute tool from parent context with request `cwd` pointing at child/target repo.
- The requested gremlin resolves from the target repo project agents and executes successfully.
- A same-name parent/user agent fixture should not mask the assertion; assert result source/path or output proves target project agent was used.

**Guardrails**
- Resolve relative `cwd` against `ctx.cwd` before discovery and validation.
- Do not add package discovery or scope toggles.
- Keep project-over-user precedence unchanged within the effective cwd.

**Verification**
- Initial bug-proof command after adding the test only: `npm test -- extensions/pi-gremlins/index.execute.test.js` should fail with unknown gremlin or wrong source under current parent-cwd discovery behavior.

### 6. Move discovery to effective per-request cwd
**What**
- Change tool execution so each request resolves/validates `cwd` before discovering agents, and uses discovery results for that effective cwd.

**References**
- `extensions/pi-gremlins/index.ts`
- `extensions/pi-gremlins/index.execute.test.js`
- `extensions/pi-gremlins/gremlin-discovery.ts`

**Acceptance criteria**
- Requests without `cwd` continue discovering from `ctx.cwd`.
- Requests with absolute or relative `cwd` discover from the resolved target cwd.
- Mixed batches can resolve agents from different effective cwds without cross-contamination.
- Invalid cwd still returns structured failed gremlin results.

**Guardrails**
- Do not pre-discover once at `ctx.cwd` for all requests.
- Do not change scheduler result shape or gremlin ids.
- Avoid broad refactors; a small helper for preparing request + discovery is acceptable if tested.

**Verification**
- `npm test -- extensions/pi-gremlins/index.execute.test.js`

### 7. Add diagnostics for agent file load failures
**What**
- Stop silently swallowing markdown load/parse failures during gremlin and primary-agent discovery; expose diagnostics without breaking discovery of other valid files.

**References**
- `extensions/pi-gremlins/gremlin-discovery.ts`
- `extensions/pi-gremlins/gremlin-discovery.test.js`
- `extensions/pi-gremlins/primary-agent.test.js`
- `extensions/pi-gremlins/index.ts` and `extensions/pi-gremlins/primary-agent-controls.ts` only if surfacing diagnostics to UI/messages is needed.

**Acceptance criteria**
- Discovery result types include non-fatal diagnostics/errors for files that could not be loaded or parsed.
- Existing valid files still load when another file fails.
- Tests assert diagnostic includes file path/basename and a concise error message.
- User-visible paths that already consume discovery can report diagnostics in command/list/startup contexts without crashing.

**Guardrails**
- Keep valid discovery results backward-compatible: existing `gremlins`, `agents`, `projectAgentsDir`, and `fingerprint` fields remain.
- Do not throw for a single bad agent file unless all discovery infrastructure is unavailable.
- Do not include raw prompt bodies in diagnostics.

**Verification**
- `npm test -- extensions/pi-gremlins/gremlin-discovery.test.js extensions/pi-gremlins/primary-agent.test.js`

### 8. Strengthen discovery fingerprint against same-size/same-mtime content changes
**What**
- Update discovery fingerprints so cache invalidates when markdown content changes but file size and mtime are unchanged.

**References**
- `extensions/pi-gremlins/gremlin-discovery.ts`
- `extensions/pi-gremlins/gremlin-discovery.test.js`

**Acceptance criteria**
- Add a test that rewrites an agent file to different same-length content and resets mtime to the original timestamp; next `get()` returns a new result and new raw markdown.
- Fingerprint includes a content-derived component for markdown files, e.g. a lightweight hash of file contents.
- Directory listing cache optimization may remain, but known-file fingerprinting must detect content changes.

**Guardrails**
- Do not rely only on `mtimeMs`, `ctimeMs`, or file size.
- Keep discovery limited to user and nearest project `.pi/agents` directories.
- Avoid expensive full-tree work beyond the known markdown files already considered.

**Verification**
- Initial bug-proof command after adding test only: `npm test -- extensions/pi-gremlins/gremlin-discovery.test.js` should fail before the hash/content fingerprint change.
- After implementation: `npm test -- extensions/pi-gremlins/gremlin-discovery.test.js`

### 9. Make bare model id ambiguity explicit
**What**
- Change bare gremlin model resolution so multiple providers with the same model id report ambiguity, not `Unknown gremlin model`.

**References**
- `extensions/pi-gremlins/gremlin-session-factory.ts`
- `extensions/pi-gremlins/gremlin-session-factory.test.js`
- `extensions/pi-gremlins/index.execute.test.js` if terminal failure message coverage is useful.

**Acceptance criteria**
- Add/modify tests where registry contains `{ provider: "openai", id: "gpt-5" }` and `{ provider: "anthropic", id: "gpt-5" }`; `resolveGremlinModel("gpt-5", ...)` returns an error containing `Ambiguous gremlin model: gpt-5` and the matching provider-qualified ids.
- Zero bare-id matches still report `Unknown gremlin model: <id>`.
- One bare-id match still resolves to provider-qualified label and model.
- Fully qualified `provider/model` behavior stays unchanged.

**Guardrails**
- Do not auto-pick a provider for ambiguous bare ids.
- Do not change frontmatter schema; this is only diagnostic behavior.
- Do not hide the terminal failed-result path when a model cannot resolve.

**Verification**
- `npm test -- extensions/pi-gremlins/gremlin-session-factory.test.js extensions/pi-gremlins/index.execute.test.js`

### 10. Final cross-cutting cleanup and verification
**What**
- Re-read all modified files, remove unused imports/dead helper code, and run full repository checks.

**References**
- All modified files from tasks above.
- `package.json` scripts.

**Acceptance criteria**
- All six audit findings have targeted regression coverage and passing implementations.
- No public schema changes.
- No new runtime anti-patterns from AGENTS guidance.
- No unused exports/imports introduced; if a new export is added, at least one import outside the defining file exists or the export is removed.

**Guardrails**
- Do not broaden into PRD/ADR work; caller stated no PRD/ADR required for these quality/reliability bug fixes.
- Do not edit unrelated docs/changelog unless implementation reveals a user-facing behavior change beyond diagnostics.
- Keep diffs minimal and localized to listed files unless tests reveal a direct dependency.

**Verification**
- `npm test`
- `npm run typecheck`
- Optional combined check: `npm run check`

## Open Risks / Unknowns
- Exact user-visible diagnostic surface for discovery load failures may depend on existing Pi UI/message behavior; prefer existing `ctx.ui.notify` / `pi.sendMessage` patterns already used by primary-agent controls.
- Content hashing in discovery increases per-known-file reads; expected small because scope is only user plus nearest project `.pi/agents` markdown files.
- Corrupt settings recovery may overwrite invalid JSON; this is intentional for this extension’s settings file but should be called out in test names and implementation comments if added.
