![Gizmo](docs/gremlins.png)
# Gremlins🧌 (`pi-gremlins`)

Pi package. Adds `Gremlins🧌` user-facing tool branding for summoning specialized workers through isolated in-process Pi SDK child sessions.

Suggested GitHub About text:

> Gremlin-flavored Pi package for isolated in-process SDK child delegation.

## What tool does

`Gremlins🧌` runs one or more gremlins with isolated child-session context.

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

Gremlin definitions load from:

- `~/.pi/agent/agents`
- nearest project `.pi/agents`

Only markdown files with `agent_type: sub-agent` frontmatter are loaded as gremlins. Untyped files and other agent types, such as `agent_type: primary`, are ignored.

```yaml
---
name: researcher
description: Research-focused gremlin
agent_type: sub-agent
---
```

If user and project define same gremlin name, project version wins among discovered sub-agent definitions.

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

## Repo layout

```text
.
├── extensions/pi-gremlins/
│   ├── index.ts
│   ├── gremlin-schema.ts
│   ├── gremlin-definition.ts
│   ├── gremlin-discovery.ts
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
