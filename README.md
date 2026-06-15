# Plot

```txt
PLOT CONTROL PLANE █
AGENT FLEET [TYPESCRIPT]

LOOP: tick -> reconcile -> act
MODE: operator supervised
STATUS: early / online
```

Plot is a control plane for long-running coding agents.

It finds work, starts agents, tracks runs, retries later, and gives you a terminal dashboard when something needs attention. Normal local entrypoints use the machine-local Plot Server, so `plot tui` and `plot run` sessions appear in the same local roster without exposing a remote server.

```bash
npm install -g plot-ai
plot tui --workflow WORKFLOW.md
```

## Why

Coding agents are useful. Running them is still awkward.

You either babysit one prompt at a time, or build brittle scripts that over-control the agent.

Plot sits between those extremes:

```txt
tick -> reconcile -> act
```

Your workflow finds work. Plot schedules it. The agent keeps its judgment.

Plot handles the operational layer:

- concurrency
- retries and backoff
- stale-run timeouts
- run history and diagnostics
- usage and cost visibility
- a protocol stream for automation
- a TUI for humans

## Try the PR reviewer

From a repo branch with an open GitHub PR:

```bash
plot tui --workflow examples/pr-review/WORKFLOW.md
```

Or run one pass without the dashboard:

```bash
plot run --workflow examples/pr-review/WORKFLOW.md
```

`plot run` opens a temporary `oneshot` Plot Session in the Local Plot Server while it runs and keeps Session History afterward.

You need:

- `gh` installed and authenticated
- a branch with an associated pull request
- agent provider auth configured

## Workflows

A workflow is Markdown plus config.

```md
---
name: review-current-pr
extension:
  source: ./github-pr-reviewer.extension.ts
agent:
  provider: openai-codex
  model: gpt-5.5
  thinking: high
resources:
  contextFiles: true
  skills:
    - ./skills/pr-review
---

# Review {{ work.title }}

Use GitHub, tests, and judgment. Post one useful review.
```

The extension discovers work. The prompt teaches the agent how to handle it.

No hidden project magic: workflow resources are explicit. `.plot/` is runtime state, not surprise behavior.

## Extensions

Extensions are trusted TypeScript.

They can read GitHub, Linear, CI, logs, queues, files, or databases. They return work items. Plot runs them.

Extensions can also register pi-native tools for API-shaped side effects where TypeScript should own correctness, such as posting a review or updating a ticket. Those tools are passed directly to the Agent Run Plot schedules for the Work Item.

Build workflows like:

- review open PRs
- investigate failed CI
- triage production errors
- refresh generated docs
- check dependency updates
- run recurring repo maintenance

Plot should not care what kind of work it is. It should care whether the work is running, waiting, blocked, failed, or complete.

## Dashboard

```bash
plot tui --workflow WORKFLOW.md
```

The TUI is built for watching a fleet, not tailing a log. Closing it detaches the UI from the Local Plot Server session; it does not kill the session.

It shows:

- running work
- blocked work
- retries and backoff
- stale runs
- token usage and cost
- recent activity
- raw debug events

Your workflow can provide titles, labels, URLs, and short status text. Plot owns the rendering.

## Docs

- [Quickstart](docs/quickstart.md)
- [Workflows](docs/workflows.md)
- [Extensions](docs/extensions.md)
- [TUI](docs/tui.md)

For LLM-assisted extension authoring:

```bash
plot docs extension-prompt | pbcopy
```

## Developing

```bash
bun install
bun run check
```

## Releases

Releases happen from tags.

```bash
git tag v0.1.0
git push origin v0.1.0
```

Prereleases publish to the `beta` npm tag. Run `bun run release:local --version <version>` before cutting one.
