<!--THIS IS A GENERATED FILE - DO NOT MODIFY DIRECTLY-->
# SIDE-CHAT KNOWLEDGE BASE

**Generated:** 2026-05-03T08:35:15Z
**Commit:** f167e65
**Branch:** main

## OVERVIEW
Persistent overlay domain for `/gremlins:chat`, `/gremlins:chat:new`, `/gremlins:tangent`, and `/gremlins:tangent:new` child sessions.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Command lifecycle | `side-chat-command.ts` | registration, restore, overlay, submit/finalize |
| Child session config | `side-chat-session-factory.ts` | chat/tangent prompts, resource loader, SDK defaults |
| Overlay UI | `side-chat-overlay.ts` | top-center non-capturing TUI component and key handling |
| Persistence | `side-chat-persistence.ts` | branch custom entries, resets, history prompt filtering |
| Transcript state | `side-chat-transcript-state.ts` | streaming rows, errors, thread row projection |
| Tests | `../test/side-chat/*.test.js` | command, overlay, persistence, session factory, transcript |

## CONVENTIONS
- Modes are exactly `chat` and `tangent`; each keeps separate persisted thread/reset state.
- `:new` discards prior thread history for that mode only.
- Overlay closes on Escape without losing completed thread history.
- Side-chat child sessions omit explicit `tools`; Pi SDK defaults and enabled extension custom tools may apply.
- Fresh child resource loader may expose intended skills; side-chat does not inherit parent transcript as live history.
- Filter side-chat custom entries out of parent transcript/context snapshots.

## ANTI-PATTERNS
- Do not reintroduce pi-gizmo dependency or separate package boundary.
- Do not make overlay capturing/fullscreen by default.
- Do not couple side-chat event projection to gremlin runner internals.
- Do not share chat history with tangent history, or reset both from one `:new` command.
- Do not add explicit side-chat tool allowlists unless ADR-0008 is superseded.
