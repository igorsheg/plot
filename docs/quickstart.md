# Quickstart

## Install and authenticate

```bash
npm install -g plot-ai
plot auth login
plot models openai
```

## Create a real Source-driven Workflow

Plot begins with a real Source. This minimal Extension turns `.todo` files into Work Items.

`todos.extension.ts`:

```ts
import { readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { definePlotExtension, defineTool } from "plot-ai/sdk";

const directory = join(process.cwd(), "todos");

export default definePlotExtension({
	id: "todo-files",
	create() {
		return {
			tools: [
				({ work }) =>
					defineTool({
						name: "mark_done",
						label: "Mark done",
						description: "Delete the selected todo after completing it.",
						parameters: { type: "object", properties: {} },
						execute: async () => {
							await unlink(join(directory, work.id));
							return {
								content: [{ type: "text", text: "done" }],
								terminate: true,
							};
						},
					}),
			],
			async discover() {
				const names = await readdir(directory);
				return names
					.filter((name) => name.endsWith(".todo"))
					.map((name) => ({ id: name, title: `Complete ${name}` }));
			},
		};
	},
});
```

`WORKFLOW.md`:

```md
---
name: todo-files
agent:
  provider: openai-codex
  model: gpt-5.5
extension:
  source: ./todos.extension.ts
plot:
  tickIntervalMs: 30000
---

Complete the task described in `todos/{{ work.id }}`, then call `mark_done`.
```

Run it:

```bash
mkdir todos
printf 'write a haiku about queues\n' > todos/haiku.todo
plot check WORKFLOW.md
plot WORKFLOW.md
```

The first command validates the Workflow, loads the Extension, checks Source requirements, and validates model/auth readiness without discovery. The second starts or attaches to the Workflow's durable Session.

## Stop, or explicitly detach

Press `q` or Ctrl-C and confirm to stop the Session. Press `d` when you deliberately want it to continue in the background; Plot prints the exact stop command before returning to the shell.

```bash
plot WORKFLOW.md         # reconstruct and reattach
plot web                 # inspect the local fleet
plot stop WORKFLOW.md    # explicit shutdown
```

`plot start WORKFLOW.md` starts in the background without opening the TUI.

## Reuse one Extension

Create another Workflow with the same `extension.source` but a different Extension `config`, prompt, model, or runtime policy. Plot treats it as a separate Workflow, so both may have an Active Plot Session concurrently.

## State

```txt
.plot/sessions/        durable Session History
.plot/skills/          default project skill path
.plot/prompts/         default project prompt-template path
~/.plot/agent/         provider auth, model catalog, Agent Transcripts
```

Provider and model selection belongs in the Workflow. There is no generic settings file or invocation-time model override.
