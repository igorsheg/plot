# Extensions

A Plot extension is trusted TypeScript that observes an external system, returns versioned Work Items, and optionally registers safe tools. Plot owns scheduling and Agent Run lifecycle; the Workflow prompt owns investigation and judgment.

Use only the public SDK:

```ts
import {
	definePlotExtension,
	defineTool,
	DiscoveryUnavailableError,
	type PlotExtensionWork,
} from "plot-ai/sdk";
```

Do not import `@plot/session`, `@plot/agent`, or files under `packages/*`. Other API clients are ordinary application dependencies, but all Plot symbols must come from `plot-ai/sdk`. Extensions run with the user's process permissions and are not sandboxed.

## Copyable extension

`demo.extension.ts`:

```ts
import { definePlotExtension, defineTool } from "plot-ai/sdk";

const completed = new Set<string>();
const identity = (item: { id: string; version?: string }) =>
	JSON.stringify([item.id, item.version ?? null]);

export default definePlotExtension({
	id: "demo",

	create({ registerTool, work }) {
		registerTool(({ work: current }) =>
			defineTool({
				name: "describe_work",
				label: "Describe work",
				description: "Return the authoritative identity of this Work Item.",
				parameters: {
					type: "object",
					properties: { note: { type: "string" } },
				},
				execute: async (params) => {
					const note = typeof params.note === "string" ? params.note : "";
					return {
						content: [
							{
								type: "text",
								text: `${current.id}@${current.version ?? "unversioned"} ${note}`.trim(),
							},
						],
						details: { id: current.id, version: current.version },
					};
				},
			}),
		);

		return {
			async discover({ signal } = {}) {
				signal?.throwIfAborted();
				const item = work({
					id: "demo:hello",
					version: "1",
					title: "Write a greeting",
					context: { audience: "Plot users" },
					display: { primary: "demo", title: "Write a greeting" },
				});
				return completed.has(identity(item)) ? [] : [item];
			},

			completed({ work: finished }) {
				completed.add(identity(finished));
			},
		};
	},
});
```

`WORKFLOW.md`:

```md
---
name: demo
agent:
  maxTurns: 1
extension:
  source: ./demo.extension.ts
---

Complete {{ work.title }} for {{ audience }}.
Use `describe_work` if you need to confirm the selected item.
```

The in-memory completion set is suitable only for a demo. A production extension should derive current work from an authoritative API, filesystem, database, or CLI and use idempotent mutation tools.

## Module and setup contract

`definePlotExtension` accepts:

- `id`: required stable Source id. Keep it stable across sessions.
- `parseConfig(input)`: optional sync/async boundary validator for Workflow `extension.config`.
- `create(context)`: required sync/async setup that returns the runtime.

The module may export the extension as `default` or as named export `extension`.

`create` receives:

- `workflow`: parsed Workflow definition.
- `paths`: resolved `cwd`, `plotDir`, `agentDir`, `sessionDir`, `skillsDir`, `extensionsDir`, and `promptsDir`.
- `config`: parsed extension config.
- `work(input)`: typed identity helper; currently returns the input Work Item.
- `registerTool(toolOrFactory)`: registers a static tool or a per-Work-Item tool factory.

Setup runs once per Plot Session. Do not launch Agent Sessions or implement a second scheduler from `create`.

## Work Item contract

```ts
interface PlotExtensionWork {
	id: string;
	version?: string;
	title?: string;
	url?: string;
	subject?: string;
	status?: "pending" | "waiting" | "blocked" | "cancelled";
	blockedReason?: string;
	workspace?: string;
	display?: WorkDisplay;
	operatorActions?: readonly OperatorAction[];
	context?: unknown;
}
```

Fields:

- `id`: stable domain identity, for example `github:acme/web:pr:42`. Never use random ids or timestamps.
- `version`: domain revision that should create new work, such as a head SHA, update token, CI attempt, or dependency version. Omit only when identity alone is sufficient.
- `title`, `url`, `subject`: generic metadata. `subject` defaults to `id` and groups versions of the same domain item.
- `status`: Source-owned scheduling state described below. Default: `pending`.
- `blockedReason`: explanation for `waiting` or `blocked` work.
- `workspace`: absolute per-work directory. Plot creates it and runs the Agent Session there.
- `display`: generic presentation hints only: `kind`, `primary`, `title`, `subtitle`, `url`, `version`, `labels`.
- `operatorActions`: human choices for blocked work.
- `context`: compact facts merged into the Workflow prompt. It is not a step-by-step agent program.

Plot's internal work key includes extension `id`, Work Item `id`, and `version`. A changed version supersedes the old version. Plot lets an active old version drain before dispatching the replacement; it does not kill successful work merely because a new revision appeared.

Duplicate work identities in one discovery result are rejected.

## Discovery and scheduling

The runtime must implement:

```ts
async discover({ signal } = {}): Promise<readonly PlotExtensionWork[]>
```

Plot polls once per tick. Reconciliation, continuation checks, and completion processing use that tick's single observation; they do not call `discover` repeatedly inside one tick.

Discovery has five outcomes for a known item:

1. `pending` — present and eligible for dispatch. This is the default.
2. `waiting` — present and claimed but not dispatchable; the external world must change.
3. `blocked` — present and claimed but not dispatchable; a human decision is needed.
4. `cancelled` — interrupt an active Agent Run and release the claim immediately.
5. Absent — the item is done or gone. An active Agent Run becomes draining: it finishes its current turn, receives no continuation turn, then releases the claim without redispatch.

Returning `[]` means every previously discovered item is absent. Never convert an observation outage into an empty list.

If discovery cannot observe the world because of network, auth, rate-limit, or service failure, throw. Plot preserves last-known work and retries on a later tick:

```ts
try {
	return await readAuthoritativeWork();
} catch (error) {
	throw new DiscoveryUnavailableError("work discovery failed", {
		cause: error,
	});
}
```

Any thrown error has the same preservation behavior; `DiscoveryUnavailableError` communicates intent.

Failed and timed-out Agent Runs are eligible for redispatch with exponential backoff: 10s, 20s, 40s, 80s, 160s, then a 300s cap. Success, interruption, disappearance, or version replacement resets retry history.

`extension.maxConcurrentRuns` applies a per-Source concurrency cap.

## Tools

A tool definition has this complete contract:

| Field              | Required | Meaning                                                                          |
| ------------------ | -------: | -------------------------------------------------------------------------------- |
| `name`             |      yes | Stable machine name exposed to the agent. Names must be unique in one extension. |
| `label`            |      yes | Short human-readable activity label.                                             |
| `description`      |      yes | What the tool does and when to use it.                                           |
| `promptSnippet`    |       no | Concise tool-specific prompt text.                                               |
| `promptGuidelines` |       no | Additional usage rules.                                                          |
| `parameters`       |      yes | Supported JSON-schema subset.                                                    |
| `executionMode`    |       no | `sequential` or `parallel`.                                                      |
| `execute`          |      yes | Sync/async implementation receiving normalized params and `{ signal? }`.         |

Supported `parameters` schema types are `string` (with optional `enum`), `number`, `integer`, `boolean`, `array` (optional `items`), and `object` (optional `properties` and `required`). For object schemas, Plot passes only declared properties and recursively normalizes declared arrays/objects.

`execute(params, context)` returns:

```ts
{
  content: [{ type: "text", text: "operator-visible result" }],
  details?: unknown,
  terminate?: boolean,
}
```

Honor `context.signal` for abortable I/O. Keep mutations idempotent and re-check identity/version before writing.

Use a factory to bind a tool to the selected Work Item and Agent Run:

```ts
registerTool(({ work, runId, config, paths }) =>
	defineTool({
		name: "post_result",
		label: "Post result",
		description: "Post one verified result for the selected Work Item.",
		parameters: {
			type: "object",
			properties: { body: { type: "string" } },
			required: ["body"],
		},
		execute: async (params, { signal }) => {
			const body = typeof params.body === "string" ? params.body : "";
			await postResult({ work, runId, body, signal, config, paths });
			return { content: [{ type: "text", text: "Result posted." }] };
		},
	}),
);
```

`postResult` is application code in this example. Plot does not provide it.

Tools should expose integration capabilities, not prescribe every reasoning step. The Agent Session owns its internal strategy.

## Operator Actions

Use `waiting` when the world must move and `blocked` when a person must choose. Blocked work may expose actions:

```ts
work({
	id: "release:v1",
	version: "candidate-3",
	title: "Release v1",
	status: "blocked",
	blockedReason: "Approval required",
	operatorActions: [
		{
			id: "approve",
			label: "Approve",
			tone: "primary",
			requiresComment: false,
			confirm: {
				title: "Approve release?",
				message: "This resumes discovery.",
			},
		},
	],
});
```

An `OperatorAction` supports `id`, `label`, optional `tone` (`primary`, `secondary`, `danger`), `disabledReason`, `requiresComment`, and `confirm` (`title`, optional `message`).

Plot records the choice as an Operator Observation and calls optional `operatorAction(event)`. The event includes `work`, `runId?`, `actionId`, `actionLabel`, `timestamp`, `comment?`, `actor?`, and `clientId?`. The hook performs bookkeeping or an idempotent integration write; later `discover` remains authoritative.

## Lifecycle hooks

The runtime may implement:

- `started({ work, runId? })`
- `completed({ work, runId?, output? })`
- `failed({ work, runId?, error })`
- `interrupted({ work, runId? })`
- `timedOut({ work, runId? })`
- `operatorAction(event)`
- `shutdown({ signal }?)`

Hooks are for bookkeeping around Plot-owned execution. They may be async. `shutdown` runs once; active runs receive interruption bookkeeping during shutdown. Cleanup and active-run bookkeeping are protected even when hooks fail.

Do not use lifecycle hooks to launch nested agents or replace discovery with hidden state transitions.

## Production checklist

- Stable extension `id`, Work Item `id`, and revision-based `version`.
- Boundary validation in `parseConfig` and external response parsing.
- Observation failures throw; authoritative empty discovery is intentional.
- `waiting`, `blocked`, `cancelled`, and absence have deliberate meanings.
- Context is compact; large payloads are loaded through tools.
- Tool `name`, `label`, schema, abort behavior, identity checks, and idempotency are explicit.
- Done work disappears; changed work retains `id` and changes `version`.
- Workspaces are absolute and isolated when concurrent work can mutate files.
- No private imports, custom dashboard components, hidden scheduler, or nested Agent Sessions.
