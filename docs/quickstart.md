# Quickstart

## Install and authenticate

```bash
npm install -g plot-ai        # installs the `plot` binary
plot auth login               # pick a provider interactively
plot models                   # confirm the catalog is reachable
```

(`npx plot-ai --help` works without installing.)

Optional defaults, so Workflows don't need to name a model:

```bash
plot config set defaultProvider openai-codex --global
plot config set defaultModel gpt-5.5 --global
```

Global settings live at `~/.plot/settings.json`; project overrides at `.plot/settings.json`.

## Run one task

```bash
mkdir plot-demo && cd plot-demo
plot init
plot open WORKFLOW.md
```

`plot init` writes a one-shot Workflow: no extension, one synthetic Work Item, the Markdown prompt runs once, the Session is recorded, done. `plot run WORKFLOW.md` does the same without a dashboard.

## Run discovered work

Source-driven Workflows are the real product: an extension observes an external system and every discovered item becomes scheduled agent work.

**The fast path** — have your coding agent build it:

```bash
plot docs guide   # paste this brief into your agent with your use case
```

**The manual path** — a minimal pair. `todos.extension.ts` turns every `.todo` file in a directory into a Work Item; deleting the file completes it:

```ts
import { readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { definePlotExtension, defineTool } from "plot-ai/sdk";

const DIR = "./todos";

export default definePlotExtension({
	id: "todo-files",
	create({ work, registerTool }) {
		registerTool(({ work: current }) =>
			defineTool({
				name: "mark_done",
				label: "Mark done",
				description: "Delete the selected .todo file when done.",
				parameters: { type: "object", properties: {} },
				execute: async () => {
					await unlink(join(DIR, current.id)).catch(() => {});
					return {
						content: [{ type: "text", text: "done" }],
						terminate: true,
					};
				},
			}),
		);
		return {
			async discover() {
				const names = await readdir(DIR);
				return names
					.filter((name) => name.endsWith(".todo"))
					.map((name) => work({ id: name, title: `Complete ${name}` }));
			},
		};
	},
});
```

`WORKFLOW.md`:

```md
---
name: todo-files
extension:
  source: ./todos.extension.ts
plot:
  tickIntervalMs: 30000
---

Complete the task described in ./todos/{{ work.id }}, then call `mark_done`.
```

```bash
mkdir todos && echo "write a haiku about queues" > todos/haiku.todo
plot doctor WORKFLOW.md
plot open WORKFLOW.md
```

Add another `.todo` file while it runs — the next tick discovers it. Note there is no completion bookkeeping anywhere: the directory is the state. That principle, applied to real systems, is the whole extension model — see [Extensions](extensions.md), and the shipped `examples/pr-review/` for a production-shaped GitHub reviewer.

## Choose an operator surface

```bash
plot open WORKFLOW.md         # live terminal dashboard
plot open WORKFLOW.md --web   # browser dashboard and HTTP API
plot run WORKFLOW.md          # no dashboard; finish current work
plot runs                     # shared run catalog
plot events stream <run-id>   # durable replay then live JSONL
```

## Project state

```txt
.plot/settings.json    project provider/model defaults
.plot/sessions/        durable Session RuntimeEvent JSONL
.plot/skills/          automatically searched skill path
.plot/prompts/         automatically searched prompt-template path
```

Agent auth and global settings default to `~/.plot/agent` and `~/.plot/settings.json`. Agent transcripts are separate from Plot's RuntimeEvent history.

Next: [Workflows](workflows.md) for the front-matter contract, [Extensions](extensions.md) for the discovery semantics, or `plot docs guide` to hand the whole job to your agent.
