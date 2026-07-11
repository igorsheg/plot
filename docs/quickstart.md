# Quickstart

## Install or run without installing

```bash
npm install -g plot-ai
plot --help
```

Or use npm's package runner:

```bash
npx plot-ai --help
```

The npm package installs the `plot` binary for the current supported platform.

## Authenticate an agent provider

```bash
plot auth
plot auth login
plot models
```

`plot auth` is shorthand for `plot auth status`. Login prompts for a provider when none is supplied.

Optional defaults:

```bash
plot config set defaultProvider openai-codex --global
plot config set defaultModel gpt-5.5 --global
plot config set defaultThinkingLevel high --global
```

Global settings live at `~/.plot/settings.json`. Project overrides live at `.plot/settings.json`.

## Run one task

```bash
mkdir plot-demo && cd plot-demo
plot init
plot open WORKFLOW.md
```

`plot init` creates a one-shot Workflow. Without an extension, Plot creates one synthetic Work Item, runs the Markdown prompt, records the Session, and stops after completion.

Use `plot run WORKFLOW.md` for the same one-shot behavior without a dashboard.

## Run discovered work

Create `demo.extension.ts`:

```ts
import { definePlotExtension } from "plot-ai/sdk";

const completed = new Set<string>();

export default definePlotExtension({
	id: "demo",
	create({ work }) {
		return {
			async discover() {
				if (completed.has("demo:hello")) return [];
				return [
					work({
						id: "demo:hello",
						version: "1",
						title: "Write a greeting",
						context: { audience: "Plot users" },
						display: { primary: "demo", title: "Write a greeting" },
					}),
				];
			},
			completed({ work: finished }) {
				completed.add(finished.id);
			},
		};
	},
});
```

Create `WORKFLOW.md`:

```md
---
name: demo
agent:
  provider: openai-codex
  model: gpt-5.5
  maxTurns: 1
extension:
  source: ./demo.extension.ts
---

Complete {{ work.title }} for {{ audience }}.
```

Validate and run:

```bash
plot doctor WORKFLOW.md
plot open WORKFLOW.md
```

This in-memory completion set is only a minimal example. Real extensions should derive work from an authoritative external system and make tools idempotent.

## Choose an operator surface

```bash
plot open WORKFLOW.md         # live terminal dashboard
plot open WORKFLOW.md --web   # browser dashboard and HTTP API
plot run WORKFLOW.md          # no dashboard; finish current work
plot runs                     # shared run catalog
plot events stream <run-id>   # durable replay then live JSONL
```

## Project state

Defaults under the project root:

```txt
.plot/settings.json    project provider/model defaults
.plot/sessions/        durable Session RuntimeEvent JSONL
.plot/skills/          automatically searched skill path
.plot/prompts/         automatically searched prompt-template path
```

Agent auth, models, and global settings default under `~/.plot/agent` and `~/.plot/settings.json`. Agent transcripts are separate from Plot's RuntimeEvent history.

Next: [Workflows](workflows.md), then [Extensions](extensions.md).
