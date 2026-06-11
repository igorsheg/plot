# Plot

**A control plane for long-running coding agents.**

Plot watches for work, reconciles what changed, starts agent sessions, and gives you a terminal dashboard for the whole fleet.

It is not a workflow engine that tries to script every thought an agent has. Plot owns orchestration. The agent owns the investigation.

```bash
npm install -g plot-ai
plot --help
```

## Why Plot exists

Most agent automation falls into one of two traps:

- **Too manual** — you run one prompt at a time and babysit every step.
- **Too rigid** — a pipeline decides every tool call and turns a capable agent into a form filler.

Plot sits in the middle.

It gives you a small runtime loop:

```txt
tick -> reconcile -> act
```

Sources observe the world and decide what work exists. Plot schedules that work, tracks attempts, handles wakeups and lifecycle, and streams events into a dashboard. Agent sessions get a clear task and then use their own tools, judgment, and context to do the job.

## Install

```bash
npm install -g plot-ai
plot --help
```

The npm package installs the `plot` binary for your platform.

## Try it with PR review

Plot ships with a standalone GitHub PR review example.

From this repository:

```bash
plot tui --workflow examples/pr-review/WORKFLOW.md
```

Or run once without the dashboard:

```bash
plot run --workflow examples/pr-review/WORKFLOW.md
```

The example expects:

- GitHub CLI installed and authenticated
- a current branch with an associated pull request
- provider/model auth configured through pi-compatible agent auth

## What you get

### A generic fleet dashboard

```bash
plot tui --workflow WORKFLOW.md
```

The TUI shows running work, status, retries/backoff, token usage, recent events, detail view, config view, and raw debug events. It is generic over workflows and plugins — PR review is just one example.

### A plain TypeScript extension surface

Extensions are trusted local code. They discover work and reconcile completions using normal TypeScript.

They can contribute display hints like title, subtitle, labels, and URL. They do not own rendering or keybindings.

### Agent sessions with agency

Plot does not micromanage inner agent reasoning. A workflow prompt can give posture, invariants, and expectations. The agent session decides which files to read, which commands to run, and how to complete the task.

## Workflow shape

A workflow is a Markdown file with front matter:

```md
---
name: my-workflow
agent:
  provider: openai-codex
  model: gpt-5.5
  thinking: high
extension:
  source: ./my-extension.ts
plot:
  tickIntervalMs: 300000
resources:
  contextFiles: true
  skills:
    - ./skills/review
---

# {{ workflow.name }}

Handle: {{ work.title }}

Use the repository, tools, and judgment. Produce one durable result.
```

`--cwd` controls the project/runtime root. Workflow resources are explicit; Plot does not auto-load mutable `.plot/agent/skills` behavior.

## Commands

```bash
plot list-models
plot auth status
plot auth login
plot run --workflow WORKFLOW.md
plot tui --workflow WORKFLOW.md
plot serve stdio --workflow WORKFLOW.md
```

`serve stdio` is the machine protocol mode. It keeps stdout protocol-clean and sends logs/telemetry elsewhere.

## Developing Plot

```bash
bun install
bun run check
```

Useful package checks:

```bash
bun run typecheck
bun run test
bun run lint
bun run format:check
```

## Releases

Releases are tag-driven.

```bash
git tag v0.1.0
git push origin v0.1.0
```

Prereleases publish on the `beta` npm tag:

```bash
git tag v0.1.0-beta.1
git push origin v0.1.0-beta.1
```

Local release validation:

```bash
bun run release:local --version 0.1.0-beta.1
```

## Status

Plot is early. The important shape is in place:

- Effect-free TypeScript runtime
- async queues/event streams
- protocol-bound TUI control plane
- plugin display metadata without plugin-owned UI
- standalone PR review example
- Bun single-executable platform packages via `plot-ai`

The bet is simple: keep orchestration explicit, keep agents capable, and make the operator experience good enough that you can trust a fleet instead of tailing logs.
