# Plot

```txt
PLOT CONTROL PLANE █  tick -> reconcile -> act
```

Plot is a control plane for long-running coding agents: find work, start agents, track runs, and show TUI/web dashboards when something needs attention.

```bash
npm install -g plot-ai
plot --workflow WORKFLOW.md
```

## Why

Agents are useful; running them is awkward. Plot sits between babysitting one prompt and building brittle scripts that over-control the agent.

```txt
workflow finds work -> Plot schedules it -> agent keeps judgment
```

Plot handles concurrency, wakeups, stale-run timeouts, history, diagnostics, usage/cost, dashboards, and `plot api --stdio` automation.

## Try the PR reviewer

```bash
plot --workflow examples/pr-review/WORKFLOW.md
plot run --workflow examples/pr-review/WORKFLOW.md # one pass, no dashboard
```

Needs: authenticated `gh`, a branch with a PR, and agent provider auth. Optional defaults live in `~/.plot/settings.json` or `.plot/settings.json`:

```json
{ "defaultProvider": "openai-codex", "defaultModel": "gpt-5.5" }
```

## Workflows and extensions

A Workflow is Markdown plus config. The extension discovers Work Items; the prompt tells the agent how to handle them.

```md
---
name: review-current-pr
extension: { source: ./github-pr-reviewer.extension.ts }
agent: { provider: openai-codex, model: gpt-5.5 }
resources: { contextFiles: true }
---

# Review {{ work.title }}

Use GitHub, tests, and judgment. Post one useful review.
```

Extensions are trusted TypeScript. They read systems like GitHub, Linear, CI, logs, queues, files, or databases; return Work Items; and register tools for side effects like posting a review.

Good fits: PR review, failed-CI investigation, production-error triage, generated docs, dependency checks, and repo maintenance. Plot should only care whether work is running, waiting, blocked, failed, or complete.

## Dashboards

```bash
plot --workflow WORKFLOW.md
plot web
```

The TUI opens a managed Plot Session. `plot web` can watch the same session. Workflows provide titles, labels, URLs, and short status text; Plot owns rendering.

## Docs and development

Docs: [Quickstart](docs/quickstart.md), [Workflows](docs/workflows.md), [Extensions](docs/extensions.md), [TUI](docs/tui.md), [Web](docs/web.md).

```bash
plot docs extension-prompt | pbcopy
bun install
bun run check
```

Releases are tag-driven from `v*`. Run `bun run release:local --version <version>` before cutting one.
