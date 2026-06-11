# Plot

```txt
PLOT CONTROL PLANE █
AGENT FLEET [TYPESCRIPT]

~~~

LOOP:   TICK -> RECONCILE -> ACT
MODE:   OPERATOR SUPERVISED
STATUS: EARLY / ONLINE

~~~

KEEP AGENTS RUNNING. KEEP HUMANS IN CONTROL.
```

Plot keeps coding agents running while you do something else.

It finds work, starts agents, tracks what happened, and gives you a terminal dashboard when things need attention.

```bash
npm install -g plot-ai
plot tui --workflow WORKFLOW.md
```

## The problem

Coding agents are powerful, but the operating model is still awkward.

You either:

- run one prompt, wait, inspect, repeat
- build a brittle script that tells the agent exactly what to do
- lose track of which agents are running, blocked, stale, or done

Plot gives agents a place to run.

Not a cage. A control plane.

## What Plot does

Plot runs a small loop:

```txt
tick -> reconcile -> act
```

On each tick, Plot asks your workflow what changed. Your workflow returns work. Plot decides what can run, starts agent sessions, tracks them, and records the result.

The agent still gets to be an agent. It can read files, run commands, inspect state, and make decisions inside the task you gave it.

Plot handles the boring operational parts:

- finding work
- starting runs
- limiting concurrency
- retrying later
- timing out stale work
- exposing extension-registered pi tools to agents
- letting extensions spawn specialist pi subagents
- showing status, usage, and cost in a terminal UI
- keeping a protocol stream for automation

## Try it

Install the CLI:

```bash
npm install -g plot-ai
plot --help
```

Run the PR review example from a repository with an open GitHub PR:

```bash
plot tui --workflow examples/pr-review/WORKFLOW.md
```

Or run it once without the dashboard:

```bash
plot run --workflow examples/pr-review/WORKFLOW.md
```

The example expects:

- `gh` installed and authenticated
- a branch with an associated pull request
- agent provider auth configured

## The dashboard

```bash
plot tui --workflow WORKFLOW.md
```

The TUI is built for watching a fleet, not tailing a log.

You can see:

- what is running
- what is blocked
- what is waiting for backoff
- which runs are stale
- token usage
- recent activity
- raw debug events when you need them

The dashboard stays generic. Your workflow can describe work with titles, labels, URLs, and short status text. Plot owns the rendering.

## Workflows are just files

A workflow is a Markdown file with front matter and a prompt.

```md
---
name: review-current-pr
agent:
  provider: openai-codex
  model: gpt-5.5
  thinking: high
extension:
  source: ./github-pr-reviewer.extension.ts
plot:
  tickIntervalMs: 300000
resources:
  contextFiles: true
  skills:
    - ./skills/pr-review
---

# Review {{ work.title }}

Use the repository, GitHub CLI, tests, and your judgment.
Post one useful review.
```

The extension finds work and may register pi-native tools for integration actions. The prompt tells the agent how to handle the work.

No hidden project magic: workflow resources are explicit. `.plot/` is for runtime state, not surprise behavior.

## Extensions are plain TypeScript

Extensions are trusted local code.

They can talk to GitHub, Linear, a queue, a database, a filesystem, or anything else you can reach from TypeScript. They return work items. Plot runs them.

Extensions can also register native pi tools with `registerTool` and `defineTool`. Use tools for API-shaped side effects where TypeScript should own correctness, such as posting a GitHub review or updating a ticket. The agent still decides when and how to use them.

For coarse parallel investigation, extensions can call `runAgent` or `runAgents` to launch specialist pi agent sessions. Plot does not invent a second subagent protocol; it exposes pi-mono options and raw events through the public SDK.

That means you can build workflows like:

- review every open PR
- investigate failed CI jobs
- triage production errors
- refresh generated docs
- check dependency updates
- run recurring repo maintenance

Plot should not care what kind of work it is. It should care whether the work is running, waiting, blocked, failed, or complete.

## Learn Plot

Public author docs live in [`docs/`](docs/):

- [Quickstart](docs/quickstart.md)
- [Workflows](docs/workflows.md)
- [Extensions](docs/extensions.md)
- [TUI](docs/tui.md)

For LLM-assisted extension authoring:

```bash
plot docs extension-prompt | pbcopy
```

## Commands

```bash
plot list-models
plot auth status
plot auth login
plot docs extensions
plot docs extension-prompt
plot run --workflow WORKFLOW.md
plot tui --workflow WORKFLOW.md
plot serve stdio --workflow WORKFLOW.md
```

`plot serve stdio` is for automation. stdout is reserved for Plot protocol messages, so other tools can safely parse it.

## Developing Plot

```bash
bun install
bun run check
```

Common checks:

```bash
bun run typecheck
bun run test
bun run lint
bun run format:check
```

## Releases

Releases happen from tags.

```bash
git tag v0.1.0
git push origin v0.1.0
```

Prereleases publish to the `beta` npm tag:

```bash
git tag v0.1.0-beta.1
git push origin v0.1.0-beta.1
```

Run a local release rehearsal:

```bash
bun run release:local --version 0.1.0-beta.1
```

## Status

Plot is early.

The PR review workflow is the first serious example. The goal is broader: a small, understandable runtime for useful long-running agent work.

The taste is simple:

- workflows should feel like TypeScript, not YAML gymnastics
- agents should keep their judgment
- operators should get a dashboard, not a pile of logs
- orchestration should be explicit enough to trust
