# Extensions

Extensions are trusted TypeScript. They discover Work Items, register tools, and own integration correctness. Plot schedules Agent Runs; the Workflow prompt teaches judgment.

Use only the public SDK:

```ts
import { definePlotExtension, defineTool } from "plot-ai/sdk";
```

Do not import Plot internals (`packages/session/src/*`, `@plot/session`, etc.).

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
						context: { message: "Write a short hello from Plot." },
						display: { primary: "demo", title: "Say hello" },
					}),
				];
			},
		};
	},
});
```

```yaml
extension:
  source: ./demo.extension.ts
```

```bash
plot tui --workflow WORKFLOW.md
```

## Mental model

```txt
world -> extension -> Work Item -> Agent Run
                     └─ registered tools
```

Extension owns: what needs attention, stable ID/version, compact context, safe tools, display hints.

Prompt owns: how to investigate, what counts as done, what output should look like.

## Work Items

```ts
work({
	id: "github:acme/web:pr:42",
	version: "head-sha",
	title: "Review PR #42",
	url: "https://github.com/acme/web/pull/42",
	context: { prNumber: 42, repo: "acme/web" },
	display: {
		primary: "#42",
		title: "Fix checkout totals",
		subtitle: "acme/web · main...feature",
		version: "abc1234",
		labels: ["fresh"],
	},
});
```

Rules:

- `id`: required stable domain identity. Good: `github:acme/web:pr:42`. Bad: `Date.now()`.
- `version`: rerun trigger, such as PR head SHA, issue timestamp, CI attempt, dependency version.
- `context`: compact facts for the prompt, not a script.
- `display`: generic dashboard hints. No custom UI.

The extension is authoritative for domain state. Done work should stop appearing. Changed work should return with the same `id` and a new `version`.

## Config

Validate Workflow config with `parseConfig` when needed.

```ts
export default definePlotExtension<{ label: string }>({
	id: "linear",
	parseConfig(input) {
		const label = (input as { label?: unknown })?.label;
		if (typeof label !== "string") throw new Error("config.label required");
		return { label };
	},
	create({ config }) {
		return {
			async discover() {
				return [];
			},
		};
	},
});
```

```yaml
extension:
  source: ./linear.extension.ts
  config: { label: agent-ready }
```

## Tools

Register tools for API-shaped side effects: loading prepared context, posting reviews, updating tickets, reporting structured progress. Do not build a second orchestration system.

```ts
registerTool(
	defineTool({
		name: "post_result",
		description: "Post the final result.",
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
```

Bind tools to the current Work Item when they write results:

```ts
registerTool(({ work }) => defineTool({ name: "load_context", ... }));
```

## Operator Actions

Use `operatorActions` when a Work Item needs a human choice.

```ts
work({
	id: "release:v1",
	title: "Release v1",
	status: "blocked",
	blockedReason: "waiting for approval",
	operatorActions: [{ id: "approve", label: "Approve", tone: "primary" }],
});
```

Plot records the choice as an Operator Observation. Your extension may implement `operatorAction(event)` and later discovery decides what changed.

## Hooks and behavior

Lifecycle hooks (`started`, `completed`, `failed`, `interrupted`, `timedOut`, `shutdown`) are for bookkeeping, not replacing agent execution.

Do: stable IDs, rerun versions, compact context, env/CLI secrets, idempotent tools, no work when done.

Avoid: random IDs, giant context dumps, plugin-owned UI, hidden discovery writes, scripting every agent step, launching agent sessions from Sources, private imports.
