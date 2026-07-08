# Quickstart

```bash
npm install -g plot-ai
plot --help
```

Authenticate a provider:

```bash
plot auth
plot auth login
```

Run a Workflow:

```bash
plot open WORKFLOW.md
```

This opens a managed Plot Session in the terminal. `plot open --web` can watch the same session.

One pass without a dashboard:

```bash
plot run WORKFLOW.md
```

## PR review example

From this repo, on a branch with a GitHub PR:

```bash
plot open examples/pr-review/WORKFLOW.md
```

You need:

- `gh` installed and authenticated
- a branch with an associated PR
- agent provider auth

Optional defaults live in `~/.plot/settings.json` or `.plot/settings.json`:

```json
{ "defaultProvider": "openai-codex", "defaultModel": "gpt-5.5" }
```

## Build your own

A Workflow has two parts:

1. An extension that finds Work Items and registers tools.
2. A prompt that tells the Agent Run how to handle each Work Item.

The extension identifies targets and owns safe integration side effects. The agent investigates and makes judgments inside the Workflow prompt.
