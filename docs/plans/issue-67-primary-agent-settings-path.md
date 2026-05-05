# Issue 67 Plan: Move Primary-Agent Settings to `.pi/agents/settings.json`

## Objective
Fix GitHub issue #67 end-to-end using the provided `git-issue-fix` workflow: move primary-agent selection persistence from project `.pi/settings.json` to project `.pi/agents/settings.json`, preserve safe migration/fallback for existing users, update tests/docs/changelog, then commit, push, and open a PR that closes #67.

## Scope
- In scope: primary-agent persistence path resolution, read/write behavior, scoped migration/fallback of only `pi-gremlins.primaryAgent`, tests for new path and legacy fallback/migration, README/CHANGELOG updates, verification, commit/push/PR sequence.
- Out of scope: moving unrelated settings, changing side-chat settings behavior, PRD/ADR creation, broad persistence architecture changes, or altering primary-agent discovery/prompt injection semantics.

## Observed Context
- Issue #67 is open and requests `~/.pi/agents/settings.json`; issue body notes a typo `settings.jso` and assumes `settings.json`.
- Current primary-agent persistence is in `extensions/pi-gremlins/primary/primary-agent-persistence.ts`.
- Current implementation resolves nearest project `.pi` and reads/writes `.pi/settings.json` under `pi-gremlins.primaryAgent`.
- Existing primary-agent tests in `extensions/pi-gremlins/test/primary/primary-agent.test.js` assert `.pi/settings.json` behavior and corrupt legacy-file handling.
- `README.md` documents primary-agent restore from nearest project `.pi/settings.json`.
- `CHANGELOG.md` has an Unreleased section with prior primary-agent persistence notes.

## Required Implementation Decisions
1. **Migration vs fallback:** Implement safe migration on read/write when legacy `.pi/settings.json` contains a valid `pi-gremlins.primaryAgent` and new `.pi/agents/settings.json` does not already contain one. Copy only that key into the new file; do not move or delete unrelated legacy settings.
2. **Conflict precedence:** If both files contain `pi-gremlins.primaryAgent`, prefer the new `.pi/agents/settings.json` value and do not overwrite it from legacy.
3. **New writes:** All writes and clears must target `.pi/agents/settings.json`; the old `.pi/settings.json` must not be modified for new primary-agent persistence after migration/fallback.
4. **Corrupt new-path precedence boundary:** `.pi/agents/settings.json` is authoritative when it exists. If it exists but is unreadable or corrupt, warn and return None; do not consult legacy `.pi/settings.json`, do not migrate from legacy, and do not overwrite or repair the corrupt new file during startup/read.
5. **Legacy fallback/migration boundary:** Consult or migrate from legacy `.pi/settings.json` only when the new file is absent, or when the new file is valid JSON but lacks `pi-gremlins.primaryAgent`. Corrupt legacy settings should only warn if legacy fallback/migration is actually attempted and cannot be read; do not let legacy corruption break valid new-path reads.
6. **Path wording:** Although the issue says `~/.pi/...`, this repo currently uses the nearest project `.pi`; keep the existing project-local resolution and move the file under that `.pi/agents/` directory unless product direction explicitly changes.

## Task 1 — Inspect and confirm persistence call sites
### What
Before coding, inspect all primary-agent persistence imports/usages and related tests/docs so the change remains scoped to the persistence module and direct expectations.

### References
- `extensions/pi-gremlins/primary/primary-agent-persistence.ts`
- `extensions/pi-gremlins/index.ts`
- `extensions/pi-gremlins/primary/*.ts`
- `extensions/pi-gremlins/test/primary/primary-agent.test.js`
- `README.md`
- `CHANGELOG.md`

### Acceptance Criteria
- All call sites of `getPrimaryAgentSettingsPath`, `readPersistedPrimaryAgentSelection*`, `writePersistedPrimaryAgentSelection`, and `clearPersistedPrimaryAgentSelection` are identified.
- No unrelated settings subsystem is included in the implementation scope.
- Implementation notes confirm project-local `.pi` behavior is intentionally preserved.

### Guardrails
- Do not edit code during this inspection task except as part of later implementation tasks.
- Do not change side-chat settings behavior or side-chat tests.

### Verification
- Run/search commands during implementation:
  - `grep -R "getPrimaryAgentSettingsPath\|readPersistedPrimaryAgentSelection\|writePersistedPrimaryAgentSelection\|clearPersistedPrimaryAgentSelection" -n extensions/pi-gremlins`
  - `grep -R "\.pi/settings.json\|settings.json\|primaryAgent" -n README.md CHANGELOG.md extensions/pi-gremlins/test/primary extensions/pi-gremlins/primary`

## Task 2 — Add failing tests for new path and legacy migration/fallback first
### What
Update primary-agent tests to assert the issue #67 behavior before implementing the production change.

### References
- `extensions/pi-gremlins/test/primary/primary-agent.test.js`
- `extensions/pi-gremlins/test/helpers/test-helpers.js`

### Acceptance Criteria
- Existing persistence test now expects writes at `path.join(workspace.repoRoot, ".pi", "agents", "settings.json")`.
- Test asserts `.pi/agents/` is created automatically when selecting or clearing a primary agent.
- Test asserts persisted selection restores from `.pi/agents/settings.json` in a new session.
- Test asserts legacy `.pi/settings.json` containing only `pi-gremlins.primaryAgent` is safely migrated/fallen back into `.pi/agents/settings.json` and restored.
- Test asserts unrelated keys in legacy `.pi/settings.json` remain in the old file and are not copied wholesale into the new file.
- Test asserts when both legacy and new files contain primary-agent selections, the new file wins.
- Test asserts after migration or command writes, legacy `.pi/settings.json` is not modified for new primary-agent writes.
- Test asserts if `.pi/agents/settings.json` exists but is corrupt/unreadable while legacy `.pi/settings.json` contains a valid primary-agent selection, startup/read warns and returns None, does not read/fallback to legacy, does not migrate, and leaves the corrupt new file untouched.
- Test asserts legacy fallback/migration happens only when `.pi/agents/settings.json` is absent or valid JSON without `pi-gremlins.primaryAgent`.
- Test asserts when valid `.pi/agents/settings.json` lacks `pi-gremlins.primaryAgent` but contains unrelated keys, migration preserves those unrelated new-path keys while adding only `pi-gremlins.primaryAgent` from legacy.
- Existing corrupt-settings tests are updated or split to cover authoritative corrupt new-path behavior and corrupt legacy fallback behavior.

### Guardrails
- Add focused tests in the existing primary-agent test file; do not create broad integration fixtures unless necessary.
- Do not weaken existing assertions that raw markdown is not persisted.
- Keep tests deterministic with temp workspaces; no real home directory access.

### Verification
- Run the focused test before production changes and confirm expected failure:
  - `bun test extensions/pi-gremlins/test/primary/primary-agent.test.js`
- Expected pre-fix failure: tests still find writes/reads at old `.pi/settings.json` or missing `.pi/agents/settings.json`.

## Task 3 — Implement new path resolution and scoped migration/fallback
### What
Change primary-agent persistence to read/write `.pi/agents/settings.json`, create the agents directory as needed, and safely migrate/fallback a valid legacy `pi-gremlins.primaryAgent` value when the new file lacks that key.

### References
- `extensions/pi-gremlins/primary/primary-agent-persistence.ts`

### Acceptance Criteria
- `getPrimaryAgentSettingsPath(cwd)` returns nearest project `.pi/agents/settings.json` or `path.resolve(cwd)/.pi/agents/settings.json` when no `.pi` exists.
- `writePersistedPrimaryAgentSelection` reads/merges only the new settings file, then writes only `.pi/agents/settings.json`.
- `clearPersistedPrimaryAgentSelection` writes `NONE_SELECTION` only to `.pi/agents/settings.json`.
- `readPersistedPrimaryAgentSelectionWithDiagnostics` reads from new path first and treats an existing new settings file as the precedence boundary.
- If `.pi/agents/settings.json` exists but cannot be parsed/read, the function warns and returns None without checking legacy `.pi/settings.json`, without migrating, and without writing to either file during startup/read.
- If `.pi/agents/settings.json` is absent, legacy `.pi/settings.json` is checked for a valid `pi-gremlins.primaryAgent`.
- If `.pi/agents/settings.json` is valid JSON but lacks `pi-gremlins.primaryAgent`, legacy `.pi/settings.json` is checked for a valid `pi-gremlins.primaryAgent`.
- If a valid legacy primary-agent selection is found and new settings do not already define one, it is copied to `.pi/agents/settings.json` while preserving any unrelated keys already present in the valid new file and copying only `pi-gremlins.primaryAgent` from legacy.
- Legacy `.pi/settings.json` is not deleted, not modified, and unrelated legacy keys are not copied to the new file.
- Invalid/missing legacy values produce no crash and return None unless a diagnostic is warranted for an unreadable/corrupt file during an allowed legacy fallback/migration attempt.
- No `as any`, `@ts-ignore`, or `@ts-expect-error` are introduced.

### Guardrails
- Keep the migration scoped to the `pi-gremlins.primaryAgent` key only.
- Do not change serialized `PrimaryAgentSessionEntryData` shape.
- Do not migrate side-chat or any other package settings.
- Do not write to the legacy path in any code path.
- Preserve current behavior for corrupt new settings: startup does not crash and warning diagnostics remain visible.
- Do not mask corrupt new settings with legacy fallback; corrupt `.pi/agents/settings.json` must remain user-actionable and untouched.

### Verification
- Re-read the modified persistence file.
- Run focused tests:
  - `bun test extensions/pi-gremlins/test/primary/primary-agent.test.js`

## Task 4 — Update README and CHANGELOG
### What
Update user-facing documentation to describe the new primary-agent settings location and add the issue #67 changelog entry.

### References
- `README.md`
- `CHANGELOG.md`

### Acceptance Criteria
- README primary-agent persistence text references nearest project `.pi/agents/settings.json` under `pi-gremlins.primaryAgent`.
- README notes existing `.pi/settings.json` primary-agent selections are safely migrated or used as fallback.
- CHANGELOG Unreleased section includes a concise issue #67 entry mentioning new path, agents-directory creation, and legacy migration/fallback.
- Existing side-chat note that it does not read side-chat-specific `.pi/settings.json` remains accurate and is not rewritten as primary-agent behavior.

### Guardrails
- Do not add PRD/ADR documents for this narrow persistence-location change.
- Do not over-document internal migration mechanics beyond user-relevant behavior.

### Verification
- `grep -n "primary-agent\|primary agent\|\.pi/agents/settings.json\|\.pi/settings.json" README.md CHANGELOG.md`

## Task 5 — Run full verification and inspect diff
### What
Run the repository verification expected by the issue workflow and inspect the final diff for scope control.

### References
- `package.json`
- All modified files

### Acceptance Criteria
- Focused primary-agent tests pass.
- Full test suite passes.
- Typecheck passes.
- `npm run check` passes because it is available and combines typecheck/test.
- Diff only includes expected changes to persistence, primary-agent tests, README, CHANGELOG, and this plan file unless implementation reveals a necessary direct dependency.

### Guardrails
- Do not hide type errors.
- Do not skip failing tests without documenting the blocker.
- Do not include generated/cache/node_modules changes.

### Verification
Run:
- `bun test extensions/pi-gremlins/test/primary/primary-agent.test.js`
- `npm test`
- `npm run typecheck`
- `npm run check`
- `git status --short`
- `git diff --check`
- `git diff -- extensions/pi-gremlins/primary/primary-agent-persistence.ts extensions/pi-gremlins/test/primary/primary-agent.test.js README.md CHANGELOG.md docs/plans/issue-67-primary-agent-settings-path.md`

## Task 6 — Commit, push, and open PR via git-issue-fix workflow
### What
After implementation and verification pass, follow the provided `git-issue-fix` release workflow: commit, push branch `issue-67`, and open a PR that closes issue #67.

### References
- Branch: `issue-67`
- Remote: `git@github.com:magimetal/pi-gremlins.git`
- Issue: `https://github.com/magimetal/pi-gremlins/issues/67`

### Acceptance Criteria
- Commit includes only scoped issue #67 changes.
- Commit message references issue #67, e.g. `Fix primary-agent settings path (#67)`.
- Branch `issue-67` is pushed to origin.
- PR is opened against the repository default branch with body including `Closes #67` and verification commands/results.

### Guardrails
- Do not commit or push until all verification is passing, or explicitly document any blocker in the PR if instructed to proceed despite failure.
- Do not squash unrelated local changes into the commit.
- Do not close the issue manually outside the PR flow.

### Verification
Run:
- `git status --short`
- `git diff --check`
- `git add extensions/pi-gremlins/primary/primary-agent-persistence.ts extensions/pi-gremlins/test/primary/primary-agent.test.js README.md CHANGELOG.md docs/plans/issue-67-primary-agent-settings-path.md`
- `git commit -m "Fix primary-agent settings path (#67)"`
- `git push -u origin issue-67`
- `gh pr create --fill --body-file <prepared-pr-body-with-Closes-67-and-verification>`
- `gh pr view --web` or `gh pr view --json url,title,body`

## Open Risks / Unknowns
- **Observed:** Current code uses nearest project `.pi`, while issue wording says `~/.pi`; this plan preserves existing project-local semantics because README and tests already frame persistence that way.
- **Inferred:** Migration-on-read is preferable to pure fallback because it satisfies “old location not used for new writes after migration” and makes subsequent reads independent of legacy state.
- **Unknown:** Exact desired warning behavior for corrupt legacy file when new settings are absent; keep diagnostics useful but avoid warning if valid new settings already exist.
