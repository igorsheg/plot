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

`plot tui` opens a foreground, terminal-owned Plot Session for this project/workflow. Quitting or pressing Ctrl-C closes that session and stops the daemon too when it was the last live session. `plot web` starts a small localhost web gateway, opens the browser, and proxies to the shared Local Plot Server roster. Pressing Ctrl-C in `plot web` stops only that web gateway. Browser tabs detach when closed; they do not own session lifetime.

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
- the TUI or web dashboard to show running review work, usage, and cost

## What you need to build your own workflow

A workflow has two pieces:

1. An extension that finds work.
2. A prompt that tells the agent how to handle that work.

The extension does not review code, triage issues, or debug CI by itself. It identifies the target, passes context, and may expose tools for safe external actions. The Agent Run does the investigation inside the workflow prompt and may call extension tools when useful.

## Generate a workflow

```bash
plot dynamic "Audit each packages/* package and write a report" --out workflows/package-audit --tui
```

`plot dynamic` generates a normal Workflow Bundle, validates it, and repairs it if validation fails. `--tui` opens the forge session while it works.
