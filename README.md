![Gizmo](docs/gremlins.png)

# Gremlins🧌 (`pi-gremlins`)

`pi-gremlins` is a Pi package for delegating work to isolated in-process SDK child sessions, selecting a parent-session primary agent, and opening persistent side-chat overlays without leaving the current Pi session.

Human-facing UI uses the label **Gremlins🧌**. Package installation, extension wiring, and tool invocation use the runtime identifier `pi-gremlins`.

## Highlights

- **Isolated gremlin delegation** — summon one specialist or a bounded parallel batch through SDK child sessions.
- **One tool contract** — `gremlins: [{ intent, agent, context, cwd? }]`, with 1 to 10 requests per invocation.
- **Role-aware markdown agents** — discover `agent_type: sub-agent` gremlins and `agent_type: primary` parent roles from user and project directories.
- **Primary-agent controls** — choose the parent-session role with `/gremlins:primary` or cycle with `Ctrl+Shift+M`.
- **Active steering** — queue guidance into a running gremlin with `/gremlins:steer <G-id> <message>`.
- **Gremlin session overlay** — inspect active or completed gremlin transcripts with `/gremlins:open <G-id>` and steer active sessions from the overlay input.
- **Persistent overlays** — use `/gremlins:chat` for a transcript-aware side conversation or `/gremlins:tangent` for a clean tangent.

## Install and update

Install from GitHub:

```bash
pi install git:github.com/magimetal/pi-gremlins
# or
pi install https://github.com/magimetal/pi-gremlins
```

Install from a local checkout:

```bash
pi install /absolute/path/to/pi-gremlins
```

Install project-locally:

```bash
pi install -l git:github.com/magimetal/pi-gremlins
```

The package manifest exposes the extension at [`./extensions/pi-gremlins`](extensions/pi-gremlins/) and currently reports version `0.1.0`. Between unreleased commits, reinstall from the intended checkout, branch, or Git commit instead of relying on the version string alone.

## Quick start

Create a gremlin definition in `~/.pi/agent/agents/researcher.md`, or in the nearest project `.pi/agents/researcher.md` for the working directory you run from:

```md
---
name: researcher
description: Research-focused gremlin
agent_type: sub-agent
---

You investigate code and return concise, source-backed findings.
```

Then ask Pi to call the tool:

```text
pi-gremlins({
  gremlins: [
    {
      intent: "Get an independent architecture read before editing runtime code",
      agent: "researcher",
      context: "Inspect extensions/pi-gremlins/gremlins and summarize the scheduler/runner flow."
    }
  ]
})
```

`intent`, `agent`, and `context` are required non-empty strings. `cwd` is optional.

## Gremlin invocation

### Schema

```ts
{
  gremlins: Array<{
    intent: string;
    agent: string;
    context: string;
    cwd?: string;
  }> // min 1, max 10
}
```

One array entry runs one gremlin. Multiple entries start as a bounded parallel batch.

### Single gremlin

```text
pi-gremlins({
  gremlins: [
    {
      intent: "Check the plan before implementation",
      agent: "reviewer",
      context: "Review the README rewrite plan for sequencing and risk."
    }
  ]
})
```

### Parallel swarm

```text
pi-gremlins({
  gremlins: [
    {
      intent: "Map current behavior from source",
      agent: "researcher",
      context: "Inspect extensions/pi-gremlins/index.ts and related modules."
    },
    {
      intent: "Catch documentation accuracy risks",
      agent: "reviewer",
      context: "Compare README examples with package.json and source contracts."
    },
    {
      intent: "Draft user-facing wording",
      agent: "writer",
      context: "Create concise Markdown copy for install, quick start, and FAQ."
    }
  ]
})
```

### Per-gremlin working directory

```text
pi-gremlins({
  gremlins: [
    {
      intent: "Inspect only the extension package surface",
      agent: "researcher",
      context: "List command registration and runtime boundaries.",
      cwd: "extensions/pi-gremlins"
    }
  ]
})
```

`cwd` resolves relative to the parent session cwd unless it is absolute. It must be an existing directory. Discovery and execution use the effective cwd.

### Error behavior

The tool reports per-gremlin failures and marks the aggregate result as an error when any gremlin fails or is canceled. Common setup failures include invalid parameters, invalid `cwd`, unknown gremlin name, unknown explicit model, or ambiguous bare model id.

## Agent discovery and frontmatter

Gremlins and primary agents are plain Markdown files with YAML frontmatter.

Discovery reads direct `.md` files from:

- `~/.pi/agent/agents`
- the nearest ancestor `.pi/agents` directory for the effective cwd

Role filtering is strict:

| Role | Frontmatter | Name rules | Symlinks |
| --- | --- | --- | --- |
| Gremlin | `agent_type: sub-agent` | `name` is required | Included |
| Primary agent | `agent_type: primary` | `name`, then first H1, then filename stem | Ignored |

For `agent_type: sub-agent`, optional frontmatter fields include `description`, `model`, `thinking`, and `tools`. Untyped files and other `agent_type` values are ignored. When user and nearest-project directories define the same display name for the same role, the project definition wins. Names are sorted after role filtering and precedence merge.

Primary-agent example:

```md
---
name: Orchestrator
description: Parent-session coordination role
agent_type: primary
---

Coordinate the parent session and keep implementation scoped.
```

## Runtime and session isolation

Gremlin runs are isolated at the Pi SDK child-session context/resource boundary:

- The child system prompt is the selected sub-agent's raw Markdown.
- The child user prompt contains only caller `intent` and caller `context`.
- Child sessions do not inherit the parent conversation, parent system prompt snapshots, active primary-agent Markdown, primary prompt blocks, extensions, skills, prompts, themes, or AGENTS files.
- `model`, `thinking`, and `tools` can come from gremlin frontmatter.
- If `model` or `thinking` is omitted, the parent setting is used as fallback.
- Provider-qualified models use `provider/model-id`; bare model ids must resolve to exactly one provider/model in Pi's model registry.
- Parent abort cancels active gremlins; completed sibling results remain visible in the aggregate result.

This is context and resource isolation inside Pi's SDK runtime. It is not an OS-level sandbox, container, filesystem jail, or security boundary.

## Inline UI behavior

The tool row uses the label **Gremlins🧌** and can be expanded with Pi's standard `Ctrl+O` affordance.

Collapsed output summarizes source, status, compact model/thinking metadata when available, intent/task preview, latest activity, token usage, and errors. Expanded output adds per-gremlin details such as intent, task/context, cwd, model, thinking level, latest text/tool data, usage, errors, and steering activity.

## Active gremlin steering

Use `/gremlins:steer <G-id> <message>` to queue guidance into an active gremlin session through `AgentSession.steer(message)`.

```text
/gremlins:steer G1 keep investigating the auth flow before summarizing
```

Behavior:

- `G-id` values such as `g1` are matched case-insensitively.
- The first non-empty token is the id; the remaining text is the steering message.
- Only active gremlin sessions can be steered.
- Unknown, completed, canceled, failed, stale, setup-failed, or disposed sessions are rejected.
- If concurrent batches each have a `g1`, steering fails as ambiguous instead of guessing.
- Steering is queued for the child session; it does not interrupt a running child tool call immediately.
- Queued and SDK-rejected steering attempts appear in the inline activity stream.

Related: [PRD-0006](docs/prd/0006-active-gremlin-session-steering.md), [ADR-0006](docs/adr/0006-official-sdk-steering-for-active-gremlin-sessions.md).

## Gremlin session overlay

Use `/gremlins:open <G-id>` to open a side-chat-style overlay for a known gremlin session.

```text
/gremlins:open G1
```

Behavior:

- Opens captured transcript rows for active or completed gremlins from the current Pi session.
- `/gremlins:open` with no id opens the only known gremlin, warns when no sessions are known, and fails closed with a list when multiple sessions require an explicit id.
- Active sessions append live transcript rows at the bottom when the overlay is not scrolled away from the bottom.
- Typing in the overlay and pressing `Enter` steers active sessions through the same `AgentSession.steer(message)` path as `/gremlins:steer`.
- Completed, canceled, failed, stale, missing, or ambiguous sessions remain readable but reject steering in the transcript without closing the overlay.
- Duplicate local ids across concurrent/repeated batches fail as ambiguous instead of guessing.
- Tool transcript status rows show tool names only and do not render tool args/results, avoiding secret exposure in the overlay.

## Side-chat and tangent overlays

| Command | Behavior |
| --- | --- |
| `/gremlins:chat` | Open or resume the persistent chat overlay. The first chat thread captures a parent transcript snapshot at origin. |
| `/gremlins:chat:new` | Start a fresh chat thread and reset chat history only. |
| `/gremlins:tangent` | Open or resume the persistent tangent overlay. Tangent starts without parent transcript context. |
| `/gremlins:tangent:new` | Start a fresh tangent thread and reset tangent history only. |

Inline prompts are supported: `/gremlins:chat <prompt>` and `/gremlins:tangent <prompt>` open the overlay and submit the prompt.

Overlay behavior:

- Centered, non-capturing overlay, about 78% terminal width and up to 80% height.
- Header shows mode (`💬 chat` or `🧭 tangent`) and status.
- `Enter` submits the draft; `Escape` closes the overlay without deleting completed history.
- `Up`, `Down`, `PageUp`, `PageDown`, `Home`, and `End` scroll transcript rows.
- `Alt+/` toggles focus after a side-chat overlay exists.

Isolation behavior:

- Chat captures the parent transcript once when the first chat thread starts; it does not inherit live parent history afterward.
- Tangent starts without parent transcript context.
- Chat and tangent keep independent persistent threads and independent reset markers.
- Side-chat child sessions omit explicit `tools`, so Pi SDK default tools may apply.
- Enabled extension custom tools and fresh child-session skills may load through the child resource-loader boundary.
- Parent-loaded prompts, themes, skills, AGENTS files, and primary-agent material are not inherited.
- Side-chat currently has no per-chat model or thinking override; parent fallback is reused.

Related: [PRD-0005](docs/prd/0005-persistent-overlay-side-chat.md), [ADR-0005](docs/adr/0005-persistent-overlay-side-chat.md), [PRD-0008](docs/prd/0008-side-chat-sessions-use-sdk-default-tools-and-extension-custom-tools.md), [ADR-0008](docs/adr/0008-sdk-default-side-chat-tool-capabilities.md).

## Primary agents

Primary agents are parent-session roles selected from `agent_type: primary` Markdown files.

Commands and controls:

| Control | Behavior |
| --- | --- |
| `/gremlins:primary` | Open an interactive picker when UI is available; otherwise list primary agents in the transcript. |
| `/gremlins:primary <name>` | Select by name. Exact matches win; ambiguous case-insensitive matches warn instead of guessing. |
| `/gremlins:primary none` | Clear the active primary agent. |
| `Ctrl+Shift+M` | Cycle through `None` and discovered primary agents. |

Selections are stored in the current session branch and persisted to the nearest project `.pi/agents/settings.json` under the `pi-gremlins.primaryAgent` settings namespace/key. On each parent turn, the selected primary agent's raw Markdown is appended to the parent system prompt inside `pi-gremlins` prompt block markers. This prompt injection is parent-only and is not inherited by gremlin child sessions or side-chat sessions.

Legacy `pi-mohawk` prompt blocks are stripped during prompt injection, and older persisted selection data is handled as migration/deprecation history where supported by existing session state.

Related: [PRD-0003](docs/prd/0003-primary-agent-selection-and-pi-mohawk-deprecation.md), [ADR-0003](docs/adr/0003-unified-agent-discovery-and-primary-agent-prompt-injection-in-pi-gremlins.md).

## Repository layout

```text
.
├── README.md
├── CHANGELOG.md
├── package.json
├── docs/
│   ├── adr/
│   └── prd/
└── extensions/
    └── pi-gremlins/
        ├── agents/       # shared markdown agent parsing
        ├── gremlins/     # discovery, execution, sessions, scheduler, steering
        ├── primary/      # primary-agent selection, persistence, prompt injection
        ├── rendering/    # inline tool-row rendering
        ├── shared/       # schemas and shared helpers
        ├── side-chat/    # chat/tangent overlays and sessions
        └── test/         # Bun tests
```

## Development and verification

Install dependencies:

```bash
npm install
```

Available package scripts:

```bash
npm run typecheck
npm test
npm run check
```

`npm test` runs:

```bash
bun test extensions/pi-gremlins/test/**/*.test.js
```

Keep documentation examples source-checked against [`package.json`](package.json), [`extensions/pi-gremlins/index.ts`](extensions/pi-gremlins/index.ts), and [`extensions/pi-gremlins/shared/gremlin-schema.ts`](extensions/pi-gremlins/shared/gremlin-schema.ts).

## Troubleshooting and FAQ

### The `pi-gremlins` tool does not appear after install

Reinstall from the intended source and confirm the package manifest points Pi at `./extensions/pi-gremlins`. For unreleased fixes, confirm the installed checkout or commit rather than only checking version `0.1.0`.

### A gremlin is not found

Confirm the file is a direct `.md` file in `~/.pi/agent/agents` or the nearest project `.pi/agents`, has `agent_type: sub-agent`, and has a non-empty `name` in frontmatter. Project definitions override same-role user definitions with the same display name.

### A primary agent is not appearing

Confirm the file has `agent_type: primary`, is not a symlink, and is in the user agents directory or nearest project `.pi/agents` for the current cwd. Primary display names fall back from `name` to the first H1 to the filename stem.

### `cwd` fails

Relative `cwd` values resolve against the parent session cwd. The resolved path must already exist and be a directory.

### Steering is rejected

Only active gremlins can be steered. Completed, failed, canceled, stale, setup-failed, disposed, unknown, or ambiguous ids are rejected. Steering waits for the child session boundary and does not stop a currently running tool call.

### The side-chat overlay does not open

The overlay requires an interactive UI. In non-UI contexts, open commands may warn instead of drawing the overlay.

### What context does side-chat receive?

Chat captures a parent transcript snapshot only at chat-thread origin. Tangent receives no parent transcript. Neither mode inherits parent prompts, themes, AGENTS files, primary-agent material, or parent-loaded skills.

### Is this a security sandbox?

No. Gremlin and side-chat sessions isolate Pi context/resources, not operating-system access. Tool availability still determines what a child session can do.

## Contributing, maintenance, and license

- Keep README examples aligned with the source under [`extensions/pi-gremlins/`](extensions/pi-gremlins/).
- Update [`CHANGELOG.md`](CHANGELOG.md) for notable user-facing documentation changes.
- Link PRDs and ADRs only when the referenced files exist under [`docs/prd/`](docs/prd/) or [`docs/adr/`](docs/adr/).
- No license file is present in this checkout; do not assume a license until one is added.
