# Restructure `extensions/pi-gremlins` into Feature Folders

## Objective
Move `extensions/pi-gremlins` from a flat module/test layout into modest feature and test folders while preserving runtime behavior, package entry shape, and the `pi-gremlins` runtime id.

## Constraints
- Preserve package extension entry: `package.json` `pi.extensions` remains `./extensions/pi-gremlins`.
- Preserve root runtime entry: keep `extensions/pi-gremlins/index.ts` at the extension root.
- Preserve root agent instructions: keep `extensions/pi-gremlins/AGENTS.md` at the extension root.
- Behavior-preserving TypeScript/JavaScript refactor only.
- Do not introduce barrels or deep architecture layers.
- Preserve NodeNext import specifier correctness: TypeScript source imports must use `.js` specifiers for TS modules; Bun test dynamic imports may continue to target `.ts` files where existing tests do that.
- Do not delete fixtures or helper files unless a reference check proves they are unused.
- Do not hide type errors with `as any`, `@ts-ignore`, or `@ts-expect-error`.
- Verify no dead props, unused imports, or unused exports are introduced.

## Proposed Target Layout

```text
extensions/pi-gremlins/
├── AGENTS.md
├── index.ts
├── agents/
│   └── agent-definition.ts
├── gremlins/
│   ├── gremlin-definition.ts
│   ├── gremlin-discovery.ts
│   ├── gremlin-progress-store.ts
│   ├── gremlin-prompt.ts
│   ├── gremlin-runner.ts
│   ├── gremlin-scheduler.ts
│   ├── gremlin-session-factory.ts
│   ├── gremlin-session-registry.ts
│   ├── gremlin-steer-command.ts
│   ├── gremlin-summary.ts
│   └── gremlin-tool-execution.ts
├── primary/
│   ├── primary-agent-controls.ts
│   ├── primary-agent-definition.ts
│   ├── primary-agent-persistence.ts
│   ├── primary-agent-prompt.ts
│   └── primary-agent-state.ts
├── rendering/
│   ├── gremlin-render-components.ts
│   └── gremlin-rendering.ts
├── shared/
│   ├── gremlin-async-utils.ts
│   ├── gremlin-cache-utils.ts
│   ├── gremlin-content-utils.ts
│   └── gremlin-schema.ts
├── side-chat/
│   ├── side-chat-command.ts
│   ├── side-chat-overlay.ts
│   ├── side-chat-persistence.ts
│   ├── side-chat-session-factory.ts
│   └── side-chat-transcript-state.ts
└── test/
    ├── fixtures/
    │   └── v1-contract-harness.js
    ├── helpers/
    │   └── test-helpers.js
    ├── gremlins/
    │   ├── gremlin-discovery.test.js
    │   ├── gremlin-runner.test.js
    │   ├── gremlin-scheduler.test.js
    │   ├── gremlin-schema.test.js
    │   ├── gremlin-session-factory.test.js
    │   ├── gremlin-session-registry.test.js
    │   └── gremlin-steer-command.test.js
    ├── rendering/
    │   ├── gremlin-rendering.test.js
    │   ├── index.execute.test.js
    │   └── index.render.test.js
    ├── primary/
    │   └── primary-agent.test.js
    └── side-chat/
        ├── side-chat-command.test.js
        ├── side-chat-overlay.test.js
        ├── side-chat-persistence.test.js
        ├── side-chat-session-factory.test.js
        └── side-chat-transcript-state.test.js
```

## Exact File Move Map

| Current path | Target path |
|---|---|
| `extensions/pi-gremlins/AGENTS.md` | unchanged |
| `extensions/pi-gremlins/index.ts` | unchanged |
| `extensions/pi-gremlins/agent-definition.ts` | `extensions/pi-gremlins/agents/agent-definition.ts` |
| `extensions/pi-gremlins/gremlin-async-utils.ts` | `extensions/pi-gremlins/shared/gremlin-async-utils.ts` |
| `extensions/pi-gremlins/gremlin-cache-utils.ts` | `extensions/pi-gremlins/shared/gremlin-cache-utils.ts` |
| `extensions/pi-gremlins/gremlin-content-utils.ts` | `extensions/pi-gremlins/shared/gremlin-content-utils.ts` |
| `extensions/pi-gremlins/gremlin-schema.ts` | `extensions/pi-gremlins/shared/gremlin-schema.ts` |
| `extensions/pi-gremlins/gremlin-definition.ts` | `extensions/pi-gremlins/gremlins/gremlin-definition.ts` |
| `extensions/pi-gremlins/gremlin-discovery.ts` | `extensions/pi-gremlins/gremlins/gremlin-discovery.ts` |
| `extensions/pi-gremlins/gremlin-progress-store.ts` | `extensions/pi-gremlins/gremlins/gremlin-progress-store.ts` |
| `extensions/pi-gremlins/gremlin-prompt.ts` | `extensions/pi-gremlins/gremlins/gremlin-prompt.ts` |
| `extensions/pi-gremlins/gremlin-runner.ts` | `extensions/pi-gremlins/gremlins/gremlin-runner.ts` |
| `extensions/pi-gremlins/gremlin-scheduler.ts` | `extensions/pi-gremlins/gremlins/gremlin-scheduler.ts` |
| `extensions/pi-gremlins/gremlin-session-factory.ts` | `extensions/pi-gremlins/gremlins/gremlin-session-factory.ts` |
| `extensions/pi-gremlins/gremlin-session-registry.ts` | `extensions/pi-gremlins/gremlins/gremlin-session-registry.ts` |
| `extensions/pi-gremlins/gremlin-steer-command.ts` | `extensions/pi-gremlins/gremlins/gremlin-steer-command.ts` |
| `extensions/pi-gremlins/gremlin-summary.ts` | `extensions/pi-gremlins/gremlins/gremlin-summary.ts` |
| `extensions/pi-gremlins/gremlin-tool-execution.ts` | `extensions/pi-gremlins/gremlins/gremlin-tool-execution.ts` |
| `extensions/pi-gremlins/primary-agent-controls.ts` | `extensions/pi-gremlins/primary/primary-agent-controls.ts` |
| `extensions/pi-gremlins/primary-agent-definition.ts` | `extensions/pi-gremlins/primary/primary-agent-definition.ts` |
| `extensions/pi-gremlins/primary-agent-persistence.ts` | `extensions/pi-gremlins/primary/primary-agent-persistence.ts` |
| `extensions/pi-gremlins/primary-agent-prompt.ts` | `extensions/pi-gremlins/primary/primary-agent-prompt.ts` |
| `extensions/pi-gremlins/primary-agent-state.ts` | `extensions/pi-gremlins/primary/primary-agent-state.ts` |
| `extensions/pi-gremlins/gremlin-render-components.ts` | `extensions/pi-gremlins/rendering/gremlin-render-components.ts` |
| `extensions/pi-gremlins/gremlin-rendering.ts` | `extensions/pi-gremlins/rendering/gremlin-rendering.ts` |
| `extensions/pi-gremlins/side-chat-command.ts` | `extensions/pi-gremlins/side-chat/side-chat-command.ts` |
| `extensions/pi-gremlins/side-chat-overlay.ts` | `extensions/pi-gremlins/side-chat/side-chat-overlay.ts` |
| `extensions/pi-gremlins/side-chat-persistence.ts` | `extensions/pi-gremlins/side-chat/side-chat-persistence.ts` |
| `extensions/pi-gremlins/side-chat-session-factory.ts` | `extensions/pi-gremlins/side-chat/side-chat-session-factory.ts` |
| `extensions/pi-gremlins/side-chat-transcript-state.ts` | `extensions/pi-gremlins/side-chat/side-chat-transcript-state.ts` |
| `extensions/pi-gremlins/test-helpers.js` | `extensions/pi-gremlins/test/helpers/test-helpers.js` |
| `extensions/pi-gremlins/v1-contract-harness.js` | `extensions/pi-gremlins/test/fixtures/v1-contract-harness.js` |
| `extensions/pi-gremlins/gremlin-discovery.test.js` | `extensions/pi-gremlins/test/gremlins/gremlin-discovery.test.js` |
| `extensions/pi-gremlins/gremlin-runner.test.js` | `extensions/pi-gremlins/test/gremlins/gremlin-runner.test.js` |
| `extensions/pi-gremlins/gremlin-scheduler.test.js` | `extensions/pi-gremlins/test/gremlins/gremlin-scheduler.test.js` |
| `extensions/pi-gremlins/gremlin-schema.test.js` | `extensions/pi-gremlins/test/gremlins/gremlin-schema.test.js` |
| `extensions/pi-gremlins/gremlin-session-factory.test.js` | `extensions/pi-gremlins/test/gremlins/gremlin-session-factory.test.js` |
| `extensions/pi-gremlins/gremlin-session-registry.test.js` | `extensions/pi-gremlins/test/gremlins/gremlin-session-registry.test.js` |
| `extensions/pi-gremlins/gremlin-steer-command.test.js` | `extensions/pi-gremlins/test/gremlins/gremlin-steer-command.test.js` |
| `extensions/pi-gremlins/gremlin-rendering.test.js` | `extensions/pi-gremlins/test/rendering/gremlin-rendering.test.js` |
| `extensions/pi-gremlins/index.execute.test.js` | `extensions/pi-gremlins/test/rendering/index.execute.test.js` |
| `extensions/pi-gremlins/index.render.test.js` | `extensions/pi-gremlins/test/rendering/index.render.test.js` |
| `extensions/pi-gremlins/primary-agent.test.js` | `extensions/pi-gremlins/test/primary/primary-agent.test.js` |
| `extensions/pi-gremlins/side-chat-command.test.js` | `extensions/pi-gremlins/test/side-chat/side-chat-command.test.js` |
| `extensions/pi-gremlins/side-chat-overlay.test.js` | `extensions/pi-gremlins/test/side-chat/side-chat-overlay.test.js` |
| `extensions/pi-gremlins/side-chat-persistence.test.js` | `extensions/pi-gremlins/test/side-chat/side-chat-persistence.test.js` |
| `extensions/pi-gremlins/side-chat-session-factory.test.js` | `extensions/pi-gremlins/test/side-chat/side-chat-session-factory.test.js` |
| `extensions/pi-gremlins/side-chat-transcript-state.test.js` | `extensions/pi-gremlins/test/side-chat/side-chat-transcript-state.test.js` |

## Implementation Tasks

### Task 1 — Establish baseline and move directories only

**What**
- Create target folders under `extensions/pi-gremlins/`.
- Move files according to the exact file map.
- Keep `index.ts` and `AGENTS.md` at the root.
- Do not edit code content in this task except path moves if the implementation tool requires atomic rename operations.

**References**
- `extensions/pi-gremlins/`
- `extensions/pi-gremlins/index.ts`
- `extensions/pi-gremlins/AGENTS.md`

**Acceptance criteria**
- `extensions/pi-gremlins/index.ts` still exists.
- `extensions/pi-gremlins/AGENTS.md` still exists.
- No listed source/test/helper file is missing after the move.
- No extra source/test duplicate remains at the old flat path after imports are rewritten.

**Guardrails**
- Do not change `package.json` `pi.extensions`.
- Do not introduce `index.ts` barrel files inside feature folders.
- Do not delete helpers, fixtures, or tests.

**Verification**
- Manual/file check: list `extensions/pi-gremlins` and confirm it matches the target layout.
- Manual/file check: confirm `package.json` still has `"./extensions/pi-gremlins"` under `pi.extensions`.

### Task 2 — Rewrite production TypeScript imports with NodeNext-safe `.js` specifiers

**What**
- Update `index.ts` imports from root-relative flat paths to feature-folder paths.
- Update moved TS files' relative imports to their new locations.
- Preserve existing named exports/imports; do not add re-export barrels.
- Keep `.js` specifiers for TS-to-TS runtime imports.

**References**
- `extensions/pi-gremlins/index.ts`
- `extensions/pi-gremlins/agents/*.ts`
- `extensions/pi-gremlins/gremlins/*.ts`
- `extensions/pi-gremlins/primary/*.ts`
- `extensions/pi-gremlins/rendering/*.ts`
- `extensions/pi-gremlins/shared/*.ts`
- `extensions/pi-gremlins/side-chat/*.ts`

**Acceptance criteria**
- No production TS import still references a removed flat sibling such as `./gremlin-schema.js` from `index.ts` or moved feature files.
- All TS-to-TS import specifiers end with `.js` and point to the correct relative target under NodeNext resolution.
- Imports remain direct to the owning file; no new barrel modules exist.

**Guardrails**
- Avoid broad renames of exported symbols.
- Avoid moving implementation between modules.
- Avoid changing runtime constants such as `TOOL_NAME = "pi-gremlins"`.

**Verification**
- `grep -R "from \"\.\/gremlin\|from './gremlin\|from \"\.\/primary\|from './primary\|from \"\.\/side-chat\|from './side-chat" extensions/pi-gremlins --include='*.ts' --include='*.js'` should only show valid same-folder imports or no stale root-flat imports.
- `npm run typecheck` passes in the final verification sequence.

### Task 3 — Rewrite test imports and fixture/helper paths

**What**
- Update tests moved under `test/` to import source modules from the correct relative feature paths.
- Update helper imports to `../helpers/test-helpers.js` or `../../test/helpers/test-helpers.js` as appropriate from each test folder.
- Update fixture/harness imports after moving `v1-contract-harness.js` to `test/fixtures/`.
- Update the harness dynamic import of root extension entry from `./index.ts` to `../../index.ts`.
- Keep existing Bun dynamic imports to `.ts` sources, adjusted only for relative path depth.

**References**
- `extensions/pi-gremlins/test/**/*.test.js`
- `extensions/pi-gremlins/test/helpers/test-helpers.js`
- `extensions/pi-gremlins/test/fixtures/v1-contract-harness.js`

**Acceptance criteria**
- Every moved test resolves its source module using the new feature folder path, e.g. `../../gremlins/gremlin-runner.ts`, `../../rendering/gremlin-rendering.ts`, `../../primary/primary-agent-prompt.ts`, `../../side-chat/side-chat-command.ts`, or `../../index.ts`.
- Every test that needs the contract harness imports `../fixtures/v1-contract-harness.js` from a `test/<feature>/` folder.
- `v1-contract-harness.js` imports `../helpers/test-helpers.js` and dynamically imports `../../index.ts`.
- No test imports `./test-helpers.js`, `./v1-contract-harness.js`, or flat-root source paths from its new folder.

**Guardrails**
- Do not convert tests from `.js` to `.ts`.
- Do not change test assertions except if a relative path string assertion explicitly references the old repo layout and must be updated to preserve intent.
- Do not delete fixture setup code unless a reference check proves it is unused.

**Verification**
- `grep -R "./test-helpers.js\|./v1-contract-harness.js\|import(\"./gremlin\|import('./gremlin\|from \"./gremlin\|from './gremlin" extensions/pi-gremlins/test --include='*.js'` returns no stale moved-test imports, except legitimate string literals inside test data if any are intentionally unrelated.
- `npm test` passes in the final verification sequence.

### Task 4 — Update package test script and include behavior

**What**
- Update `package.json` test script from the flat glob to a recursive test glob.
- Recommended script: `"test": "bun test extensions/pi-gremlins/test/**/*.test.js"`.
- Leave `typecheck` and `check` scripts unchanged unless the test script name changes force a mechanical update; it should not.

**References**
- `package.json`

**Acceptance criteria**
- `npm test` runs the moved tests under `extensions/pi-gremlins/test/`.
- `npm run check` still runs `npm run typecheck && npm test`.
- `package.json` `pi.extensions` still points to `./extensions/pi-gremlins`.

**Guardrails**
- Do not change package name, runtime id, version, files list, peer dependencies, or dev dependencies.
- Do not add new test tooling.

**Verification**
- `npm test` passes in the final verification sequence.
- Manual/file check: inspect `package.json` diff and confirm only the test script changed unless import-resolver changes unexpectedly require otherwise.

### Task 5 — Update README layout and development instructions

**What**
- Replace the README `Repo layout` tree with the new modest feature/test folder layout.
- Update the test command comment from `extensions/pi-gremlins/*.test.js` to `extensions/pi-gremlins/test/**/*.test.js`.
- Preserve published package/install/runtime wording, especially `pi-gremlins` and `./extensions/pi-gremlins`.

**References**
- `README.md`

**Acceptance criteria**
- README layout reflects `agents/`, `gremlins/`, `primary/`, `rendering/`, `shared/`, `side-chat/`, and `test/`.
- README development section describes the recursive Bun test location.
- README publish shape still states `pi.extensions` points at `./extensions/pi-gremlins`.

**Guardrails**
- Do not rewrite unrelated README sections.
- Do not change branding or runtime id semantics.

**Verification**
- Manual/file check: inspect only the README layout and development-command diff hunks.
- `npm run check` final pass provides indirect coverage that documented commands remain valid.

### Task 6 — Dead-code and path hygiene checks

**What**
- Search for stale references to old flat paths after all moves and import rewrites.
- Search for imports/exports made unused by the refactor.
- Remove any unused import introduced by the path rewrite.
- Do not remove exports unless confirmed unused outside the defining file and not intentionally part of the test/internal API.

**References**
- `extensions/pi-gremlins/**/*.ts`
- `extensions/pi-gremlins/**/*.js`
- `package.json`
- `README.md`

**Acceptance criteria**
- No import points to a file path that no longer exists.
- No old flat `.test.js` paths remain in package scripts or README development instructions.
- TypeScript reports no path-resolution errors.
- Any modified or moved export is imported at least once outside its defining file, or is intentionally exported as an external extension entry/API and documented as such in review notes.

**Guardrails**
- Do not perform opportunistic refactors.
- Do not collapse modules together.
- Do not add abstractions to avoid relative paths; direct relative imports are preferred here.

**Verification**
- `grep -R "extensions/pi-gremlins/\*.test.js\|\.\/test-helpers.js\|\.\/v1-contract-harness.js" package.json README.md extensions/pi-gremlins --include='*.ts' --include='*.js' --include='*.md'` returns no stale references except historical text if intentionally retained and explained.
- `npm run typecheck` passes in the final verification sequence.

## Smallest Safe Move Order

1. Create folders and move root-neutral shared modules first: `agents/`, `shared/`.
2. Move source feature modules: `gremlins/`, `primary/`, `rendering/`, `side-chat/`.
3. Immediately rewrite production TS imports, starting at `index.ts` and then feature folders by dependency depth:
   - shared/agents imports first,
   - gremlins discovery/definition/session modules,
   - rendering modules,
   - primary modules,
   - side-chat modules,
   - root `index.ts` last if not already done.
4. Move test helpers and fixture harness into `test/helpers/` and `test/fixtures/`, then fix harness paths.
5. Move tests into `test/<feature>/` folders and rewrite their imports.
6. Update `package.json` test glob.
7. Update README layout/test comments.
8. Run final verification sequence.

## Import Rewrite Strategy

- Use direct relative imports only.
- For TS production files, keep `.js` extensions:
  - root to feature: `./gremlins/gremlin-discovery.js`, `./rendering/gremlin-rendering.js`, `./shared/gremlin-schema.js`, etc.
  - feature to shared: `../shared/gremlin-schema.js`, `../shared/gremlin-cache-utils.js`, etc.
  - feature to agents: `../agents/agent-definition.js`.
  - feature to sibling feature: `../primary/primary-agent-definition.js`, `../gremlins/gremlin-discovery.js`, etc.
- For Bun JS tests, preserve existing `.ts` dynamic/source imports but adjust depth:
  - `test/gremlins/*` to source: `../../gremlins/<module>.ts` or `../../shared/gremlin-schema.ts`.
  - `test/rendering/*` to source: `../../rendering/<module>.ts` or `../../index.ts`.
  - `test/primary/*` to source: `../../primary/<module>.ts`, `../../gremlins/gremlin-discovery.ts`, or `../../index.ts`.
  - `test/side-chat/*` to source: `../../side-chat/<module>.ts`.
  - tests to helpers: `../helpers/test-helpers.js`.
  - tests to harness: `../fixtures/v1-contract-harness.js`.
  - harness to root entry: `../../index.ts`.

## Final Verification Sequence

Run after all implementation edits are complete:

```bash
npm run typecheck
npm test
npm run check
```

Expected results:
- `npm run typecheck` exits 0 with no NodeNext module-resolution errors.
- `npm test` exits 0 and discovers all moved tests under `extensions/pi-gremlins/test/**/*.test.js`.
- `npm run check` exits 0 and confirms the combined typecheck/test path remains valid.

## Risks and Mitigations

- **Risk: stale NodeNext `.js` import specifiers.** Mitigation: rewrite imports directly and rely on `npm run typecheck` for resolution failures.
- **Risk: moved Bun tests import wrong relative depth.** Mitigation: use the test-folder import matrix above and verify with `npm test`.
- **Risk: package entry breakage.** Mitigation: keep root `index.ts` and do not change `pi.extensions`.
- **Risk: over-architecture.** Mitigation: no barrels, no new public API surface, no symbol renames.
- **Risk: fixture/helper deletion.** Mitigation: move helpers/fixtures only; run stale-reference searches before considering any deletion.

## Self-Review Checklist

Self-review completed after re-reading this plan.

- [x] Plan keeps implementation root at `extensions/pi-gremlins/index.ts`.
- [x] Plan keeps `AGENTS.md` at extension root.
- [x] Plan includes an exact source/test/helper move map.
- [x] Plan includes import rewrite strategy for NodeNext `.js` source imports.
- [x] Plan includes test path and package test script changes.
- [x] Plan includes README update scope.
- [x] Plan includes dead-code/unused import/export guardrails.
- [x] Plan includes final verification commands: `npm run typecheck`, `npm test`, `npm run check`.
