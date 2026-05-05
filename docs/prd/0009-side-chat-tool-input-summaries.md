# PRD-0009: Side-Chat Tool Input Summaries

- **Status:** Completed
- **Date:** 2026-05-05
- **Author:** Magi Metal
- **Related:** GitHub issue [#68](https://github.com/magimetal/pi-gremlins/issues/68), [PRD-0005](0005-persistent-overlay-side-chat.md), [PRD-0008](0008-side-chat-sessions-use-sdk-default-tools-and-extension-custom-tools.md)
- **Supersedes:** N/A

## Problem Statement

Side-chat sessions can run workspace tools, but the side-chat transcript currently shows generic status labels such as `running tool: read`. Users cannot tell which file is being read or which shell command is running without waiting for later model text or inspecting lower-level logs. That weakens trust in side-chat activity and makes potentially risky tool use harder to monitor.

Issue #68 requests user-facing side-chat output that includes safe, concise details from tool inputs: `read` should show the target path/file, `bash` should show the command, and other straightforward tools should receive useful summaries while avoiding sensitive or oversized input leakage.

## User Stories

- As a side-chat user, I want `read` tool status to include the path or file being read so I can understand what the assistant is inspecting.
- As a side-chat user, I want `bash` tool status to include the command being run so I can evaluate risk before or while it executes.
- As a side-chat user, I want long or sensitive tool inputs redacted or truncated so the side-chat transcript does not expose secrets or become noisy.
- As a maintainer, I want unsupported or ambiguous tools to keep a concise fallback label so the summary feature does not misrepresent tool activity.

## Scope

### In Scope

- Enhance side-chat tool execution start status text from generic labels like `running tool: read` to safe summaries that include selected tool input details.
- Show `read` targets using the provided path/file input when available.
- Show `bash` invocations using the provided command input when available.
- Add concise summaries for other tools only when their inputs are straightforward to summarize safely.
- Redact likely sensitive fields and values from any displayed tool input summary.
- Truncate large summaries to a bounded, readable length.
- Preserve fallback behavior for unsupported tools, missing inputs, malformed inputs, or inputs that cannot be safely summarized.
- Cover the summary behavior with focused tests around side-chat transcript/status generation.

### Out of Scope

- Changing which tools side-chat sessions may use.
- Adding a permissions prompt, approval workflow, or tool policy UI.
- Displaying full tool input payloads or full tool results in the side-chat transcript.
- Changing parent-session gremlin rendering outside side-chat unless required to share a narrowly scoped sanitizer/summarizer helper.
- Changing side-chat persistence semantics, overlay commands, layout, or chat/tangent isolation behavior.

## Acceptance Criteria

- [x] When side-chat receives a `tool_execution_start` event for `read` with a path/file input, the visible status includes the tool name and that path/file, for example `running tool: read <path>`.
- [x] When side-chat receives a `tool_execution_start` event for `bash` with a command input, the visible status includes the tool name and a concise form of the command, for example `running tool: bash <command>`.
- [x] Straightforward non-`read`/`bash` tools may show concise summaries from safe scalar inputs, but unsupported, ambiguous, malformed, or missing inputs fall back to the existing concise tool-name label.
- [x] Summary generation redacts likely secrets and sensitive values, including common credential-bearing keys or text such as tokens, API keys, passwords, authorization headers, cookies, and private keys.
- [x] Summary generation truncates long values and large structured inputs to a documented bounded length while keeping the output readable.
- [x] Status text does not expose full tool input payloads, full file contents, environment dumps, or command output.
- [x] Tool completion status remains concise and accurate, and existing side-chat transcript rows, persistence, resume, `chat`/`tangent`, and reset behavior remain unchanged except for the improved start label text.
- [x] Automated tests cover `read` path display, `bash` command display, truncation, redaction, unsupported-tool fallback, and missing/malformed input fallback.

## Technical Surface

- **Side-chat transcript state:** `extensions/pi-gremlins/side-chat/side-chat-transcript-state.ts` currently emits `running tool: ${event.toolName ?? "unknown"}` for `tool_execution_start`; this is the primary product surface for the new label text.
- **Side-chat overlay rendering:** `extensions/pi-gremlins/side-chat/side-chat-overlay.ts` should continue rendering status rows without layout churn; only the row text should become more informative.
- **Side-chat persistence:** `extensions/pi-gremlins/side-chat/side-chat-persistence.ts` and `extensions/pi-gremlins/side-chat/side-chat-transcript-state.ts` must continue preserving completed exchanges without adding unsafe raw tool payloads.
- **Tests:** Add or update focused side-chat tests near the transcript/status behavior to verify safe summaries and fallbacks.
- **Related ADRs:** None required for the draft unless implementation introduces a reusable cross-surface sanitization contract or broader rendering architecture change.

## UX Notes

The side-chat transcript should stay compact. Preferred status format is a single line that starts with the current action phrase and tool name, then appends one short detail when safe: `running tool: read extensions/pi-gremlins/side-chat/side-chat-transcript-state.ts` or `running tool: bash npm test -- side-chat`.

If a value is truncated, use a clear marker such as an ellipsis. If a value is redacted, use an explicit marker such as `[redacted]`. When safety is uncertain, omit the input detail and retain the concise fallback. Accuracy beats decoration. Users have enough mysteries already.

## Open Questions

- What exact maximum character length should summaries use before truncation?
- Which tool input field names should be considered canonical for SDK built-in `read` and `bash` events in the current runtime payloads?
- Should summary text include quoting around paths/commands, or remain plain text for compactness?

## Revision History

- 2026-05-05: Draft created for GitHub issue #68.
- 2026-05-05: Marked Active for implementation.
- 2026-05-05: Marked Completed after reducer, side-chat regression, typecheck, and full check verification passed.
