# Issue #68 Implementation Plan: Side-Chat Tool Input Summaries

## Objective

Implement PRD-0009 so side-chat `tool_execution_start` transcript rows include safe, concise tool input details instead of only `running tool: <tool>`, while preserving side-chat persistence, completion labels, overlay layout, and fallback behavior.

## Evidence Snapshot

- PRD: `docs/prd/0009-side-chat-tool-input-summaries.md` is currently `Draft` and defines acceptance criteria for `read` path display, `bash` command display, redaction, truncation, unsupported/missing/malformed fallback, and unchanged completion/persistence behavior.
- Primary runtime surface: `extensions/pi-gremlins/side-chat/side-chat-transcript-state.ts`
  - `SideChatTranscriptEvent` currently includes `toolName?: string` but not `args`.
  - `reduceSideChatTranscriptEvent()` currently emits `running tool: ${event.toolName ?? "unknown"}` for `tool_execution_start`.
  - `tool_execution_end` already emits concise completion rows and should remain unchanged.
- Rendering surface: `extensions/pi-gremlins/side-chat/side-chat-overlay.ts`
  - Status rows render plain `Text(row.text)` and box-level truncation already protects layout width; no format/layout change appears necessary.
- Persistence surface: `extensions/pi-gremlins/side-chat/side-chat-persistence.ts`
  - Persisted side-chat thread entries store only completed question/answer exchange data, not transient status rows. Keep it that way.
- Focused tests: `extensions/pi-gremlins/test/side-chat/side-chat-transcript-state.test.js` covers transcript reducer behavior and is the right place for PRD-0009 start-label tests.
- Similar but insufficient existing helper: `extensions/pi-gremlins/gremlins/gremlin-runner.ts` has private `formatToolCall(toolName, args)` that displays `path`/`command` without redaction/truncation. Do not reuse it directly for side-chat safety requirements.
- Package verification commands from `package.json`: `bun test extensions/pi-gremlins/test/**/*.test.js`, `npm run typecheck`, `npm run check`.

## Key Assumptions

- **Observed:** Tool start events elsewhere in this repo use `args` for input payloads, e.g. `{ type: "tool_execution_start", toolName: "read", args: { path: "apps/web/src/main.ts" } }`.
- **Inferred:** Side-chat receives the same SDK event shape, so adding `args?: unknown` to `SideChatTranscriptEvent` is sufficient for reducer-level summarization.
- **Inferred:** A side-chat-local sanitizer/summarizer is enough; no ADR is required unless implementation expands this into a cross-surface rendering/sanitization contract.
- **Unknown:** Exact SDK built-in `read` input aliases beyond `path` and possible `file`; plan covers both and preserves fallback for anything else.

## Implementation Tasks

### Task 1 — Activate PRD-0009 before code changes

- **What:** Mark PRD-0009 as Active when implementation begins and append a revision-history note.
- **References:**
  - `docs/prd/0009-side-chat-tool-input-summaries.md`
  - `docs/prd/README.md`
- **Acceptance criteria:**
  - PRD status changes from `Draft` to `Active`.
  - `docs/prd/README.md` index row for `0009` also shows `Active`.
  - Revision history includes an implementation-start entry dated `2026-05-05`.
- **Guardrails:**
  - Do not change PRD scope or acceptance criteria unless implementation discovers a concrete mismatch.
  - Do not create an ADR for this status-only step.
- **Verification:**
  - Manual readback: `grep -n "Status:\|0009\|Revision History" docs/prd/0009-side-chat-tool-input-summaries.md docs/prd/README.md`.

### Task 2 — Add focused failing reducer tests for PRD-0009

- **What:** Extend side-chat transcript reducer tests to prove the current bug and lock PRD acceptance criteria before implementation.
- **References:**
  - `extensions/pi-gremlins/test/side-chat/side-chat-transcript-state.test.js`
  - `extensions/pi-gremlins/side-chat/side-chat-transcript-state.ts`
- **Test cases to add:**
  1. `read` with `{ path: "extensions/pi-gremlins/side-chat/side-chat-transcript-state.ts" }` produces `running tool: read extensions/pi-gremlins/side-chat/side-chat-transcript-state.ts`.
  2. `read` with `{ file: "README.md" }` also displays the file value.
  3. `bash` with `{ command: "npm test -- side-chat" }` produces `running tool: bash npm test -- side-chat`.
  4. Long path/command values are bounded and end with an ellipsis marker, not full payload text.
  5. Sensitive keys/values are redacted, covering at least `password`, `token`, `apiKey`, `authorization`, `cookie`, and private-key-looking text.
  6. Straightforward non-`read`/`bash` scalar input, e.g. `{ query: "side-chat" }`, may produce a concise summary such as `running tool: grep query=side-chat`.
  7. Unsupported nested/ambiguous input falls back to `running tool: <tool>`.
  8. Missing/malformed `args`, missing `toolName`, empty `toolName`, and non-object `args` do not throw and preserve existing fallback labels.
  9. `tool_execution_end` behavior remains unchanged, e.g. `bash failed`.
- **Acceptance criteria:**
  - New tests fail before implementation for the expected reason: start labels do not include safe input summaries.
  - Tests directly map to every PRD-0009 automated-test acceptance criterion.
- **Guardrails:**
  - Do not loosen existing defensive event tests.
  - Do not assert an exact truncation length unless the implementation exports/documents a constant used by the tests; assert bounded output and omitted tail instead.
  - Do not snapshot full sensitive payloads in expected strings.
- **Verification:**
  - Before implementation: `bun test extensions/pi-gremlins/test/side-chat/side-chat-transcript-state.test.js` should fail only on the new PRD-0009 expectations.

### Task 3 — Implement a side-chat-local safe summary helper

- **What:** Add a small helper inside `side-chat-transcript-state.ts` that formats the start status text from `toolName` and `args`.
- **References:**
  - `extensions/pi-gremlins/side-chat/side-chat-transcript-state.ts`
  - Function to update: `reduceSideChatTranscriptEvent()` case `tool_execution_start`
  - Type to update: `SideChatTranscriptEvent`
- **Implementation outline:**
  - Add `args?: unknown` to `SideChatTranscriptEvent`.
  - Replace inline `running tool: ${event.toolName ?? "unknown"}` with a private helper such as `formatSideChatToolStartStatus(event)`.
  - Normalize tool name: non-empty string only; otherwise use `unknown`.
  - Summarize only object `args`; fallback for null, arrays, strings, numbers, booleans, or malformed payloads.
  - For `read`, use first safe string among `path` then `file`.
  - For `bash`, use safe string `command`.
  - For other tools, include at most one or a few simple scalar fields only when keys and values are safe and unambiguous; otherwise fallback to tool name only.
  - Redact sensitive keys case-insensitively before display: include `password`, `passwd`, `pwd`, `secret`, `token`, `apiKey`, `api_key`, `apikey`, `authorization`, `auth`, `bearer`, `cookie`, `privateKey`, `private_key`, `pem`, `credential`.
  - Redact sensitive-looking values before display, including bearer/token-like strings, `Authorization:`/`Cookie:` snippets, and private key blocks (`-----BEGIN ... PRIVATE KEY-----`).
  - Truncate the final detail to a named bounded length, recommended `160` characters, using `…`.
  - Keep final row format one line: `running tool: <tool>` or `running tool: <tool> <detail>`.
- **Acceptance criteria:**
  - `read` and `bash` examples from PRD-0009 display safe path/command details.
  - Unsupported, missing, malformed, and unsafe inputs fall back without throwing.
  - Sensitive data is replaced with `[redacted]`.
  - Long details are truncated and never serialize full structured payloads.
- **Guardrails:**
  - Keep helper private unless another file imports it; avoid unnecessary exports.
  - Do not import or couple to `gremlins/gremlin-runner.ts`.
  - Do not use `as any`, `@ts-ignore`, or `@ts-expect-error`.
  - Do not modify overlay layout or persistence schema for this task.
- **Verification:**
  - `bun test extensions/pi-gremlins/test/side-chat/side-chat-transcript-state.test.js` passes.
  - Manual readback of `side-chat-transcript-state.ts` confirms no raw `JSON.stringify(args)`-style full payload display.

### Task 4 — Confirm overlay and persistence remain unchanged except rendered row text

- **What:** Inspect impacted side-chat surfaces and add only regression tests if implementation changes more than reducer text.
- **References:**
  - `extensions/pi-gremlins/side-chat/side-chat-overlay.ts`
  - `extensions/pi-gremlins/side-chat/side-chat-persistence.ts`
  - Existing tests:
    - `extensions/pi-gremlins/test/side-chat/side-chat-overlay.test.js`
    - `extensions/pi-gremlins/test/side-chat/side-chat-persistence.test.js`
    - `extensions/pi-gremlins/test/side-chat/side-chat-command.test.js`
- **Acceptance criteria:**
  - `side-chat-overlay.ts` still renders status rows via existing `Text(row.text)` behavior.
  - `side-chat-persistence.ts` still persists completed `{ question, answer }` exchanges and does not persist transient tool input summaries.
  - Existing side-chat command/persistence/overlay tests pass without broad rewrites.
- **Guardrails:**
  - Do not persist raw tool args or summaries into `SideChatThreadEntryData`.
  - Do not change `chat`/`tangent` isolation, reset behavior, or active session lifecycle.
  - Do not add browser/UI tooling; this is TUI reducer/render text, not browser-visible DOM behavior.
- **Verification:**
  - `bun test extensions/pi-gremlins/test/side-chat/side-chat-overlay.test.js extensions/pi-gremlins/test/side-chat/side-chat-persistence.test.js extensions/pi-gremlins/test/side-chat/side-chat-command.test.js`.

### Task 5 — Update changelog for user-facing behavior

- **What:** Add a concise `Unreleased` changelog entry for Issue #68 / PRD-0009.
- **References:**
  - `CHANGELOG.md`
  - `docs/prd/0009-side-chat-tool-input-summaries.md`
- **Acceptance criteria:**
  - Changelog mentions side-chat tool start rows now show safe concise input summaries for `read`/`bash` and redact/truncate sensitive or long values.
  - Entry references `PRD-0009` and issue `#68`.
- **Guardrails:**
  - Do not reorganize existing changelog sections.
  - Do not claim feature completion until tests and typecheck pass.
- **Verification:**
  - Manual readback: `grep -n "PRD-0009\|issue #68\|tool input" CHANGELOG.md`.

### Task 6 — Final verification and PRD completion handling

- **What:** Run targeted and full relevant checks, then mark PRD-0009 completed if all acceptance criteria are met.
- **References:**
  - `extensions/pi-gremlins/side-chat/side-chat-transcript-state.ts`
  - `extensions/pi-gremlins/test/side-chat/side-chat-transcript-state.test.js`
  - `docs/prd/0009-side-chat-tool-input-summaries.md`
  - `docs/prd/README.md`
  - `CHANGELOG.md`
- **Acceptance criteria:**
  - All PRD-0009 acceptance criteria are satisfied by tests or manual readback.
  - PRD status changes from `Active` to `Completed` only after verification passes.
  - `docs/prd/README.md` index row for `0009` also shows `Completed`.
  - Revision history includes completion date and verification summary.
- **Guardrails:**
  - If any verification fails, leave PRD status `Active` and document blocker in implementation summary.
  - Do not mark PRD completed based on unrun commands.
- **Verification commands:**
  - `bun test extensions/pi-gremlins/test/side-chat/side-chat-transcript-state.test.js`
  - `bun test extensions/pi-gremlins/test/side-chat/side-chat-overlay.test.js extensions/pi-gremlins/test/side-chat/side-chat-persistence.test.js extensions/pi-gremlins/test/side-chat/side-chat-command.test.js`
  - `npm run typecheck`
  - `npm run check`
  - Manual readback: `grep -n "Status:\|0009\|Revision History" docs/prd/0009-side-chat-tool-input-summaries.md docs/prd/README.md`

## PRD-0009 Acceptance Criteria Traceability

| PRD-0009 acceptance criterion | Planned coverage |
| --- | --- |
| `read` start status includes path/file | Task 2 tests 1-2; Task 3 helper path/file selection |
| `bash` start status includes command | Task 2 test 3; Task 3 command selection |
| Other straightforward tools may summarize, unsupported fallback | Task 2 tests 6-8; Task 3 scalar-only summarization/fallback |
| Redact likely secrets/sensitive values | Task 2 test 5; Task 3 key/value redaction rules |
| Truncate long values/large structured inputs | Task 2 test 4; Task 3 final detail bound |
| Do not expose full payloads, file contents, env dumps, command output | Task 3 no full serialization; Task 4 persistence/readback; tests verify omitted tails |
| Completion status and side-chat persistence/resume/reset unchanged | Task 2 test 9; Task 4 existing side-chat tests |
| Automated tests cover required cases | Task 2 plus Task 6 targeted/full checks |

## ADR Recommendation

No ADR recommended for the planned implementation. The change is a local transcript-label formatter aligned to PRD-0009. Create an ADR only if implementation expands into a reusable cross-surface sanitization/rendering contract shared with gremlin runner, parent tool rendering, or SDK-level tool display policy.

## Open Risks / Unknowns

- **Unknown:** SDK may use additional canonical input field names for built-in tools. Mitigation: support `read.path`, `read.file`, and `bash.command`; fallback safely for the rest.
- **Inferred risk:** Over-aggressive redaction may hide some harmless values. Prefer false positives over leaking secrets.
- **Inferred risk:** Other tools can have deceptively sensitive scalar fields. Mitigation: scalar summaries must be conservative and key-filtered; fallback when ambiguous.
- **Observed risk:** Gremlin runner has a similar unsafe private helper. Do not reuse it unless it is separately upgraded under a broader ADR-backed contract.
