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

Open the dashboard:

```bash
plot tui --workflow WORKFLOW.md
```

## Try the PR review example

From this repository, on a branch with a GitHub pull request:

```bash
plot tui --workflow examples/pr-review/WORKFLOW.md
```

The example uses:

- `gh` for GitHub
- `plot-ai/sdk` for extension authoring
- registered pi tools for GitHub/API side effects
- specialist pi subagents for parallel review passes
- a workflow prompt to teach review behavior
- the TUI to show running review work, usage, and cost

## What you need to build your own workflow

A workflow has two pieces:

1. An extension that finds work.
2. A prompt that tells the agent how to handle that work.

The extension does not review code, triage issues, or debug CI by itself. It identifies the target, passes context, and may expose tools for safe external actions. The agent does the investigation inside the workflow prompt and may call extension tools or subagents when useful.
