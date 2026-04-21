![Gizmo](docs/gremlins.png)
# Gremlins🧌 (`pi-gremlins`)

Pi package. Adds `Gremlins🧌` user-facing tool branding for summoning mischievous specialist workers in isolated Pi subprocesses.

Forked from and inspired by [`nicobailon/pi-subagents`](https://github.com/nicobailon/pi-subagents).

Suggested GitHub About text:

> Gremlin-flavored fork of pi-subagents for isolated Pi subprocess delegation.

See also [`NOTICE.md`](./NOTICE.md) for attribution note.

Fun branding. Same real Pi primitive underneath: agents. That means gremlin definitions still live in:

- `~/.pi/agent/agents`
- nearest project `.pi/agents`
- package-provided agent resources when runtime supports them

## What tool does

`Gremlins🧌` delegates work into isolated subprocesses so each gremlin gets fresh context.

Modes:

- single: one gremlin, one task
- parallel: many gremlins, many tasks, concurrency-limited
- chain: step-by-step handoff, with `{previous}` output substitution

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

Important: user-facing tool surface now appears as `Gremlins🧌`. Machine-facing package/runtime identifiers that Pi uses for install and wiring still stay `pi-gremlins`, and API still uses `agent` / `agentScope` because discovery still runs through agent directories.

Single summon:

```text
Gremlins🧌({
  agent: "researcher",
  task: "Summarize repo architecture"
})
```

Parallel swarm:

```text
Gremlins🧌({
  tasks: [
    { agent: "researcher", task: "Find auth flow" },
    { agent: "reviewer", task: "Review recent changes" }
  ]
})
```

Chain of gremlins:

```text
Gremlins🧌({
  chain: [
    { agent: "researcher", task: "Gather facts" },
    { agent: "writer", task: "Draft answer from {previous}" },
    { agent: "reviewer", task: "Critique {previous}" }
  ]
})
```

Repo-local gremlins disabled by default. To include nearest project `.pi/agents`, set:

```text
agentScope: "both"
```

or

```text
agentScope: "project"
```

UI sessions ask for trust confirmation before running repo-local gremlins by default.

Viewer command:

```text
/gremlins:view
```

Opens popup lair for latest `Gremlins🧌` run in current session.

## Repo layout

```text
.
├── extensions/pi-gremlins/
│   ├── index.ts
│   ├── agents.ts
│   ├── execution-modes.ts
│   ├── execution-shared.ts
│   ├── result-rendering.ts
│   ├── viewer-open-action.ts
│   ├── viewer-result-navigation.ts
│   └── *.test.js
├── package.json
├── NOTICE.md
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
