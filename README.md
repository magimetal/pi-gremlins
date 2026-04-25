![Gizmo](docs/gremlins.png)
# Gremlins🧌 (`pi-gremlins`)

Pi package. Adds `Gremlins🧌` user-facing tool branding for summoning specialized workers through isolated in-process Pi SDK child sessions, plus primary-agent selection formerly provided by `pi-mohawk`.

Suggested GitHub About text:

> Gremlin-flavored Pi package for isolated in-process SDK child delegation.

## What tool does

`Gremlins🧌` runs one or more gremlins with isolated child-session context. Primary-agent controls select one parent-session agent role and inject its raw markdown into the parent system prompt before each turn.

V1 contract:

- one tool name: `pi-gremlins`
- one input shape: `gremlins: [{ intent, agent, context, cwd? }]`
- array length `1..10`
- one gremlin = single run
- multiple gremlins = parallel run
- no chain mode
- no popup viewer
- no `/gremlins:view`
- no `/gremlins:steer`
- no package gremlin discovery
- no scope toggles
- inline progress only, expand with `Ctrl+O`

Agent definitions load from:

- `~/.pi/agent/agents`
- nearest project `.pi/agents`

Roles stay separated by frontmatter:

- `agent_type: sub-agent` files are gremlins that the `pi-gremlins` tool can summon.
- `agent_type: primary` files are parent-session primary agents selected through `/mohawk` or `Ctrl+Shift+M`.
- untyped files and other agent types are ignored.

Gremlin example:

```yaml
---
name: researcher
description: Research-focused gremlin
agent_type: sub-agent
---
```

Primary-agent example:

```yaml
---
name: Orchestrator
description: Parent-session role
agent_type: primary
---
```

If user and project define same display name for the same role, nearest project version wins. Primary-agent display names fall back from frontmatter `name`, to first H1, to filename stem.

Important: UI label may show `Gremlins🧌` for human-facing branding. Actual package/runtime/tool identifier stays `pi-gremlins` for install and invocation wiring.

## Install

From local checkout:

```bash
pi install /absolute/path/to/pi-gremlins
```

From GitHub:

```bash
pi install git:github.com/magimetal/pi-gremlins
# or
pi install https://github.com/magimetal/pi-gremlins
```

Project-local install:

```bash
pi install -l git:github.com/magimetal/pi-gremlins
```

## Use

Single summon:

```text
pi-gremlins({
  gremlins: [
    {
      intent: "Get independent architecture read before editing runtime code",
      agent: "researcher",
      context: "Summarize repo architecture"
    }
  ]
})
```

Parallel swarm:

```text
pi-gremlins({
  gremlins: [
    {
      intent: "Map auth implementation before parent changes code",
      agent: "researcher",
      context: "Find auth flow"
    },
    {
      intent: "Catch risks in pending changes",
      agent: "reviewer",
      context: "Review recent changes"
    },
    {
      intent: "Prepare concise user-facing release copy",
      agent: "writer",
      context: "Draft release note"
    }
  ]
})
```

Per-gremlin working directory override:

```text
pi-gremlins({
  gremlins: [
    {
      intent: "Audit frontend auth before parent edits web app",
      agent: "researcher",
      context: "Audit frontend auth code",
      cwd: "apps/web"
    }
  ]
})
```

Runtime behavior:

- `intent` is required and states why the parent is delegating or what outcome the gremlin should serve
- `context` is required and carries concrete task details, constraints, paths, findings, and requested output
- child sessions run in-process through Pi SDK
- child sessions inherit parent system prompt snapshot only
- no nested Pi CLI subprocesses
- no temp prompt files
- child sessions do not load extensions, skills, prompts, themes, or AGENTS files
- collapsed tool row shows source, status, phase, and latest activity
- expanded tool row shows intent, task, cwd, model, thinking, latest text/tool data, usage, and errors

## Primary agents

Primary-agent support replaces the separate `pi-mohawk` extension inside `pi-gremlins`.

Controls:

- `/mohawk` opens a picker when UI exists.
- `/mohawk` without UI writes `Primary agents: None, ...` into the transcript.
- `/mohawk <name>` selects exact or single case-insensitive primary-agent match.
- `/mohawk none` clears selection.
- `Ctrl+Shift+M` cycles deterministically through `[None, ...sorted primary agents]`.
- status key is `pi-gremlins-primary`; visible label is `Primary: <name|None>`.

Session behavior:

- selection is current-session branch state, not global config.
- new entries are persisted as `pi-gremlins-primary-agent` with selected name, source, and file path only.
- legacy `pi-mohawk-primary-agent` entries are read for migration; new writes use `pi-gremlins-primary-agent`.
- raw primary-agent markdown is never stored in session entries.
- missing selected primary agent resets to `None` and warns instead of injecting stale markdown.

Prompt behavior:

- selected primary-agent raw markdown is appended during `before_agent_start` inside `<!-- pi-gremlins primary agent:start -->` / `<!-- pi-gremlins primary agent:end -->`.
- existing `pi-gremlins` and legacy `pi-mohawk` primary-agent blocks are stripped before appending to avoid duplicate injection.
- `agent_type: sub-agent` gremlins are never injected as primary agents.

Migration from `pi-mohawk`:

- install updated `pi-gremlins` and use existing `/mohawk` / `Ctrl+Shift+M` controls.
- after confirming primary-agent behavior works in `pi-gremlins`, disable or uninstall `pi-mohawk` to avoid duplicate command, shortcut, status, or prompt-hook behavior.
- keep agent markdown in same user/project directories; no schema rename needed for `agent_type: primary`.

## Repo layout

```text
.
├── extensions/pi-gremlins/
│   ├── index.ts
│   ├── gremlin-schema.ts
│   ├── agent-definition.ts
│   ├── gremlin-definition.ts
│   ├── primary-agent-definition.ts
│   ├── gremlin-discovery.ts
│   ├── primary-agent-state.ts
│   ├── primary-agent-controls.ts
│   ├── primary-agent-prompt.ts
│   ├── gremlin-prompt.ts
│   ├── gremlin-session-factory.ts
│   ├── gremlin-runner.ts
│   ├── gremlin-scheduler.ts
│   ├── gremlin-progress-store.ts
│   ├── gremlin-render-components.ts
│   ├── gremlin-rendering.ts
│   ├── gremlin-summary.ts
│   └── *.test.js
├── docs/
├── package.json
└── README.md
```

## Develop

Install dev dependencies:

```bash
npm install
```

Run checks:

```bash
npm run typecheck
npm test
# or
npm run check
```

## Publish shape

Repo root is package root. Important because `pi install git:...` clones repo and reads `package.json` from repo root.

Manifest uses documented Pi package shape:

- `keywords` includes `pi-package`
- `pi.extensions` points at `./extensions/pi-gremlins`
- Pi runtime packages stay in `peerDependencies`
