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

`plot run` uses or autostarts the machine-local Plot Server, opens an ephemeral `oneshot` Plot Session, prints events, and leaves Session History visible in the local roster after completion.

Open dashboards:

```bash
plot tui --workflow WORKFLOW.md
plot web
```

`plot tui` attaches the terminal dashboard to one Plot Session. `plot web` starts the localhost fleet control plane in the foreground for every Plot Session the Local Plot Server knows about. Quitting a UI detaches that client; it does not close the Plot Session. Press Ctrl-C in the `plot web` terminal to stop that foreground Local Plot Server process. These are localhost control connections only, not remote exposure.

## Try the PR review example

From this repository, on a branch with a GitHub pull request:

```bash
plot tui --workflow examples/pr-review/WORKFLOW.md
```

The example uses:

- `gh` for GitHub
- `plot-ai/sdk` for extension authoring
- registered pi tools for GitHub/API side effects
- a workflow prompt to teach review behavior
- the TUI or web dashboard to show running review work, usage, and cost

## What you need to build your own workflow

A workflow has two pieces:

1. An extension that finds work.
2. A prompt that tells the agent how to handle that work.

The extension does not review code, triage issues, or debug CI by itself. It identifies the target, passes context, and may expose tools for safe external actions. The Agent Run does the investigation inside the workflow prompt and may call extension tools when useful.
