<!--THIS IS A GENERATED FILE - DO NOT MODIFY DIRECTLY-->
# GREMLINS RUNTIME KNOWLEDGE BASE

**Generated:** 2026-05-03T08:35:15Z
**Commit:** f167e65
**Branch:** main

## OVERVIEW
Tool execution domain for sub-agent discovery, child-session construction, parallel scheduling, progress projection, cancellation, and active steering.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Tool execution | `gremlin-tool-execution.ts` | request validation, cwd resolution, result content |
| Discovery/cache | `gremlin-discovery.ts` | user/project `.pi/agents`, precedence, diagnostics, hashing |
| Sub-agent parser | `gremlin-definition.ts` | accepts only `agent_type: sub-agent` |
| Child prompt | `gremlin-prompt.ts` | selected gremlin markdown + intent/context prompt |
| Child config | `gremlin-session-factory.ts` | model/thinking fallback, empty resource boundary |
| Child runner | `gremlin-runner.ts` | event projection, usage, final text, abort handling |
| Batch scheduler | `gremlin-scheduler.ts` | parallel run orchestration and aggregate counts |
| Active steering | `gremlin-session-registry.ts`, `gremlin-steer-command.ts` | active id registry and `/gremlins:steer` |
| Summary/progress | `gremlin-progress-store.ts`, `gremlin-summary.ts` | activity windows and model-visible summary |
| Tests | `../test/gremlins/*.test.js` | domain-specific Bun tests |

## CONVENTIONS
- `cwd` resolves against parent `ctx.cwd`; invalid directories fail per gremlin.
- Agent resolution: exact name first, then first case-insensitive match from sorted discovery.
- Project agent definitions override user definitions by same display name.
- Child sessions must not receive parent AGENTS, transcript/history, primary markdown, extensions, skills, prompts, or themes.
- Parent abort cancels active gremlins; completed sibling results remain in aggregate details.
- Steering targets active sessions only; duplicate active ids across batches are ambiguous.

## ANTI-PATTERNS
- No subprocess/RPC steering or prompt-history injection.
- No discovery cache keyed only by mtime/size when content may change.
- No aggregate failure that hides individual gremlin result details.
- No schema expansion without `shared/gremlin-schema.ts`, README, tests, and governance alignment.
