# Quickstart

Install Plot:

```bash
npm install -g plot-ai
plot --help
```

Authenticate your agent provider:

```bash
plot auth status
plot auth login
```

Run a workflow once:

```bash
plot run --workflow WORKFLOW.md
```

`plot run` opens an ephemeral oneshot run, prints events, and leaves an event log under `.plot/sessions`.

Open dashboards:

```bash
plot tui --workflow WORKFLOW.md
```

`plot tui` opens a terminal dashboard attached to a normal managed Plot run. While it is active, `plot web` can see the same run.

## Try the PR review example

From this repository, on a branch with a GitHub pull request:

```bash
plot tui --workflow examples/pr-review/WORKFLOW.md
```

The example uses:

- `gh` for GitHub
- `plot-ai/sdk` for extension authoring
- registered tools for GitHub/API side effects
- a workflow prompt to teach review behavior
- the TUI dashboard to show running review work, usage, and cost

## What you need to build your own workflow

A workflow has two pieces:

1. An extension that finds work.
2. A prompt that tells the agent how to handle that work.

The extension does not review code, triage issues, or debug CI by itself. It identifies the target, passes context, and may expose tools for safe external actions. The Agent Run does the investigation inside the workflow prompt and may call extension tools when useful.
