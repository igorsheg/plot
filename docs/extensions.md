# Extensions

> Plot can help create extensions. Ask your coding agent to build one for your use case.

Paste this doc, then say what work you want Plot to run.

Extensions are trusted TypeScript modules. They discover work and register pi-native tools. Plot schedules one Agent Run for each selected Work Item. The agent handles judgment inside the workflow prompt.

Use the public SDK:

```ts
import { definePlotExtension, defineTool } from "plot-ai/sdk";
```

Do not import from Plot internals like `packages/session/src/*` or `@plot/session`.

## Minimal extension

```ts
import { definePlotExtension } from "plot-ai/sdk";

export default definePlotExtension({
	id: "demo",

	create({ work }) {
		return {
			async discover() {
				return [
					work({
						id: "demo:hello",
						version: "1",
						title: "Say hello",
						context: {
							message: "Write a short hello from Plot.",
						},
						display: {
							primary: "demo",
							title: "Say hello",
							labels: ["example"],
						},
					}),
				];
			},
		};
	},
});
```

Wire it into `WORKFLOW.md`:

```yaml
extension:
  source: ./demo.extension.ts
```

Then run:

```bash
plot tui --workflow WORKFLOW.md
```

## Mental model

Think in three layers:

```txt
world -> extension -> work item -> Agent Run
                     └─ registered pi tools
```

The extension should answer:

- What needs attention?
- What stable ID identifies it?
- What version should rerun it?
- What context does the agent need?
- Which integration actions should be exposed as tools?
- How should it look in the dashboard?

The prompt should answer:

- How should the agent investigate?
- What counts as done?
- What should the output look like?

## Work items

A discovered work item looks like this:

```ts
work({
	id: "github:acme/web:pr:42",
	version: "head-sha",
	title: "Review PR #42",
	url: "https://github.com/acme/web/pull/42",
	context: {
		prNumber: 42,
		repo: "acme/web",
	},
	display: {
		kind: "github-pr-review",
		primary: "#42",
		title: "Fix checkout totals",
		subtitle: "acme/web · main...feature",
		url: "https://github.com/acme/web/pull/42",
		version: "abc1234",
		labels: ["fresh"],
	},
});
```

### `id`

Required. Stable domain identity.

Good:

```txt
github:acme/web:pr:42
linear:ENG-123
ci:acme/web:run:123456
```

Bad:

```txt
Date.now()
Math.random()
latest-pr
```

### `version`

Optional. Use it when the same work should rerun after a change.

Examples:

- PR head SHA
- issue updated timestamp
- CI run attempt
- dependency version

### `context`

Data for the prompt. Keep it useful and compact.

Give the agent facts, not a rigid script.

### `display`

Hints for the TUI and web dashboard. Plot owns rendering.

Extensions may provide titles, labels, URLs, and short version text. Extensions may not provide TUI components, keybindings, or custom renderers.

### `operatorActions`

Source-declared choices a human controller may perform on the Work Item. They are semantic actions, not display hints, and they are rendered generically by TUI/web.

```ts
work({
	id: "release:v1",
	title: "Release v1",
	blocked: "waiting for operator approval",
	operatorActions: [
		{
			id: "approve",
			label: "Approve",
			tone: "primary",
			confirm: { title: "Approve release?" },
		},
		{ id: "hold", label: "Hold", requiresComment: true },
	],
});
```

When an operator performs an action, Plot records an Operator Observation in Session History. The web never calls Source code directly; your extension can implement `operatorAction(event)` to update its own trusted state before later discovery/reconciliation decides what changed.

## Config

Use `parseConfig` when workflow config should be validated.

```ts
import { definePlotExtension } from "plot-ai/sdk";

type Config = {
	label: string;
};

export default definePlotExtension<Config>({
	id: "linear",

	parseConfig(input) {
		if (
			typeof input !== "object" ||
			input === null ||
			typeof (input as { label?: unknown }).label !== "string"
		) {
			throw new Error("linear extension requires config.label");
		}
		return { label: (input as { label: string }).label };
	},

	create({ config }) {
		return {
			async discover() {
				console.log(`Finding issues with label ${config.label}`);
				return [];
			},
		};
	},
});
```

Workflow:

```yaml
extension:
  source: ./linear.extension.ts
  config:
    label: agent-ready
```

## Registered tools

Extensions can register native pi tools with `registerTool`. Use tools for integration boundaries where TypeScript should own side-effect correctness: fetching prepared context, calling an API, posting a review, updating a ticket, or reporting structured progress.

Do not invent a Plot-specific tool system. Plot passes your `ToolDefinition` through to the pi agent session.

```ts
import { definePlotExtension, defineTool } from "plot-ai/sdk";

export default definePlotExtension({
	id: "demo-tools",
	create({ registerTool }) {
		registerTool(
			defineTool({
				name: "post_result",
				description: "Post the final result to the external system.",
				parameters: {
					type: "object",
					properties: { body: { type: "string" } },
					required: ["body"],
				},
				execute: async ({ body }) => ({
					content: [{ type: "text", text: `posted ${body.length} chars` }],
				}),
			}),
		);

		return {
			async discover() {
				return [];
			},
		};
	},
});
```

Tool factories can bind the current Plot work item:

```ts
registerTool(({ work }) =>
	defineTool({
		name: "load_context",
		description: `Load context for ${work.id}`,
		parameters: { type: "object", properties: {} },
		execute: async () => ({
			content: [{ type: "text", text: JSON.stringify(work.context) }],
		}),
	}),
);
```

Keep judgment in the prompt and agent. Put durable, idempotent, API-shaped operations in tools. Tools run inside the Agent Run that Plot scheduled; Plot does not expose separate agent-session helpers.

## Lifecycle hooks

Extensions can observe run lifecycle:

```ts
export default definePlotExtension({
	id: "demo",
	create() {
		return {
			async discover() {
				return [];
			},
			started(event) {
				console.log("started", event.work.id);
			},
			completed(event) {
				console.log("completed", event.work.id, event.output);
			},
			failed(event) {
				console.error("failed", event.work.id, event.error);
			},
			interrupted(event) {
				console.log("interrupted", event.work.id);
			},
			timedOut(event) {
				console.log("timed out", event.work.id);
			},
			shutdown() {
				console.log("extension shutting down");
			},
		};
	},
});
```

Use hooks for bookkeeping. Do not use them to replace the agent’s own task execution.

## Good extension behavior

Do:

- keep work IDs stable
- use versions to rerun changed work
- keep context small and relevant
- put secrets in environment variables or external CLIs
- use registered tools for idempotent external mutations
- let the workflow prompt teach judgment
- return no work when there is nothing to do

Avoid:

- random work IDs
- giant context dumps
- plugin-owned UI rendering
- hidden writes during discovery unless clearly intentional
- encoding every agent step as code
- launching separate agent sessions from the Source path
- importing private Plot modules

## LLM prompt

Use this with your coding agent:

```md
You are writing a Plot extension.

Use only the public SDK:

import { definePlotExtension, defineTool } from "plot-ai/sdk";

The extension should discover work and return stable work items. It may register pi-native tools with registerTool for API/integration side effects. The workflow prompt will tell the Agent Run how to handle the work and make judgments. Do not import Plot internals. Do not create custom TUI rendering.

Create an extension for:

<describe the work source here>
```
