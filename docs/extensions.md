# Extensions

> Plot extensions are written by coding agents. Point yours at `npx plot-ai docs guide` and describe what you want observed.

An extension is trusted TypeScript that observes an external system and returns Work Items; optionally it registers safe integration tools. That is the whole job. Plot owns scheduling, retries, concurrency, and durability; the Workflow prompt owns how the agent investigates and judges. Extensions run with the user's process permissions and are not sandboxed.

Everything Plot-related is imported from one place:

```ts
import { definePlotExtension, defineTool } from "plot-ai/sdk";
```

Do not import Plot internals. Other API clients (`octokit`, a database driver, `node:` builtins) are ordinary application dependencies.

## Where the truth lives

- **The typed contract** — `plot docs sdk` prints the SDK's TypeScript declarations, with every field's semantics in its doc comment. That file is authoritative; this page does not restate it.
- **Working code** — the package ships complete extensions (print their location with `plot docs --paths`):
  - `examples/pr-review/` — production-shaped: GitHub observation, durable state in an anchor comment, idempotent head-SHA-guarded write tools, eligibility policy as pure tested functions, Operator Actions.
  - `examples/debug/` — every lifecycle hook, `parseConfig`, workspaces, simulated discovery failure.
- **This page** — the semantics types cannot express: identity, versioning, scheduling outcomes, and what makes an extension production-ready.

## A complete minimal pair

`todos.extension.ts` — observes a directory of `.todo` files; each file is one Work Item, deleting the file completes it:

```ts
import { readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import {
	DiscoveryUnavailableError,
	definePlotExtension,
	defineTool,
} from "plot-ai/sdk";

export default definePlotExtension<{ dir: string }>({
	id: "todo-files",

	parseConfig(input) {
		if (
			typeof input !== "object" ||
			input === null ||
			typeof (input as { dir?: unknown }).dir !== "string"
		)
			throw new Error("extension.config.dir must be a string");
		return input as { dir: string };
	},

	create({ config }) {
		return {
			tools: [
				({ work }) =>
					defineTool({
						name: "mark_done",
						label: "Mark done",
						description:
							"Delete the selected .todo file once its task is complete.",
						parameters: { type: "object", properties: {} },
						execute: async () => {
							await unlink(join(config.dir, work.id)).catch(() => {});
							return {
								content: [{ type: "text", text: `${work.id} done` }],
								terminate: true,
							};
						},
					}),
			],
			async discover(context) {
				context.signal.throwIfAborted();
				let names: string[];
				try {
					names = await readdir(config.dir);
				} catch (error) {
					// Observation failed; do NOT report "no work".
					throw new DiscoveryUnavailableError("cannot read todo dir", {
						cause: error,
					});
				}
				return names
					.filter((name) => name.endsWith(".todo"))
					.map((name) => ({
						id: name,
						title: `Complete ${name}`,
						context: { file: join(config.dir, name) },
					}));
			},
		};
	},
});
```

`WORKFLOW.md` next to it:

```md
---
name: todo-files
agent:
  provider: openai-codex
  model: gpt-5.5
extension:
  source: ./todos.extension.ts
  config:
    dir: ./todos
plot:
  tickIntervalMs: 30000
---

Complete the task described in {{ file }}, then call `mark_done`.
```

```bash
plot check WORKFLOW.md
plot WORKFLOW.md
```

Notice what the extension does **not** do: no completion bookkeeping, no queue, no retry logic. The filesystem is the state — done work simply stops being discovered. Prefer this shape: derive work from an authoritative system (API, database, files, CLI) instead of tracking progress in memory. When the domain has no natural "done" marker, write one into the domain itself, the way `examples/pr-review` stamps an anchor comment on the PR.

## Identity and versions

Plot's work key is the extension `id` plus the Work Item `id` and `version`. Everything follows from that:

- `id` is stable domain identity (`github:acme/web:pr:42`). Never derive it from timestamps or randomness — an id that changes between discoveries is a different Work Item. Duplicate identities in one discovery result are rejected.
- `version` is the domain revision that should trigger a rerun: a head SHA, an update token, a dependency version. A changed version supersedes the old one — Plot lets an active run for the old version drain (it is never killed for succeeding) and dispatches the new version fresh. Omit `version` only when identity alone is sufficient.
- `subject` groups versions of the same domain item; it defaults to `id`.

## Source readiness and setup

Declare prerequisites in `runtime.requirements` when a Source cannot discover work until authentication, configuration, a binary, VPN access, or another local condition is satisfied. Requirements are Source state, not synthetic Work Items.

```ts
import { definePlotExtension } from "plot-ai/sdk";

const beginAuthorization = async (redirectUri: string) => ({
	url: `https://example.com/oauth?redirect_uri=${encodeURIComponent(redirectUri)}`,
	exchange: async (code: string) => ({ accessToken: code }),
});
const readJiraWork = async () => ({ id: "jira:1", version: "v1" });

export default definePlotExtension({
	id: "wix-jira",
	label: "Wix Jira",
	create({ credentials }) {
		return {
			requirements: [
				{
					id: "wix-mcp",
					label: "Wix MCP",
					async check({ credentials }) {
						return (await credentials.get("tokens")) === undefined
							? {
									status: "action-required",
									message: "Connect Wix MCP to discover Jira issues",
									actions: [{ id: "connect", label: "Connect Wix MCP" }],
								}
							: { status: "ready" };
					},
					async action({ actionId, interaction, credentials, signal }) {
						if (actionId !== "connect") return;
						const callback = await interaction.createOAuthCallback();
						const authorization = await beginAuthorization(
							callback.redirectUri,
						);
						await interaction.openUrl(authorization.url);
						const code = await callback.wait(signal);
						await credentials.set("tokens", await authorization.exchange(code));
					},
				},
			],
			async discover() {
				return [await readJiraWork()];
			},
		};
	},
});
```

`check()` runs before discovery and must be cheap and local: inspect credentials, environment, files, config, and installed binaries only. Do not refresh tokens or probe a network there. Plot calls `discover()` only while every requirement is `ready`; `action-required` and `unavailable` preserve last-known work and gate new dispatch.

Use `credentials` for Extension/Workflow-scoped secret values. Plot stores them in permission-restricted files and never puts them in Work Item context, prompts, events, or logs. `plot check` reports requirement state without invoking actions. Start the Session and invoke an available Operator Action from the TUI or Web Console.

If token refresh fails terminally inside `discover()` or a bound tool, delete or invalidate the cached credential and throw `ExtensionActionRequiredError`. Plot moves the Source back to `action-required`, preserves work, and exposes reconnection. Temporary network failures remain `DiscoveryUnavailableError`.

## Discovery outcomes

Plot calls `discover` once per tick and reconciles against that single observation. For a known item, discovery has exactly five outcomes:

1. **`pending`** — present and eligible for dispatch. The default.
2. **`waiting`** — present, claimed, not dispatchable; the external world must change first (CI still running, quiet period).
3. **`blocked`** — present, claimed, not dispatchable; a human must decide. Pair with `blockedReason` and `operatorActions`.
4. **`cancelled`** — interrupt any active run and release the claim immediately.
5. **Absent** — the item is done or gone. An active run drains: it finishes its current turn, receives no continuation, and releases its claim without redispatch.

Two rules keep these outcomes trustworthy:

- Returning `[]` is a statement of fact: _every previously discovered item is done or gone_. Never convert an observation outage into an empty list — throw instead (use `DiscoveryUnavailableError` to make the intent explicit) and Plot preserves last-known work and retries on a later tick.
- Failed and timed-out runs are redispatched with exponential backoff. Success, interruption, disappearance, or a new version resets the backoff. You do not implement retries.

`extension.maxConcurrentRuns` in the Workflow caps concurrent runs for the Source.

## Tools

Tools expose integration capabilities; they do not script the agent's reasoning. The full field contract (`name`, `label`, `description`, `promptSnippet`, `promptGuidelines`, `parameters`, `executionMode`, `execute`) is documented in the SDK declarations — `plot docs sdk`.

The semantics worth internalizing:

- **Bind mutations to the selected Work Item with a factory.** A factory receives `{ work, runId, config, paths, workflow }` and is resolved once per Agent Run. Closing over `work` lets `execute` re-check identity and version before writing — a stale run may still call a tool after the world moved on.
- **Make writes idempotent.** Plot may rerun work after failures; a tool that appends duplicate comments on retry is a bug. `examples/pr-review` guards every write with the PR head SHA.
- **Arguments are normalized, not validated.** Only properties declared in `parameters` reach `execute` (recursively); types are not coerced. Validate inside `execute`.
- **Honor `context.signal`** for abortable I/O, and return `terminate: true` from an explicit finish tool when the run should stop after the call.

Statuses like `waiting` and `blocked` decide _whether_ an agent runs; tools decide _what it can touch_ while running.

## Operator Actions

Use `waiting` when the world must move and `blocked` when a person must choose. Blocked work may expose choices:

```ts
import { definePlotExtension } from "plot-ai/sdk";

export default definePlotExtension({
	id: "release",
	create() {
		return {
			async discover() {
				return [
					{
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
								confirm: {
									title: "Approve release?",
									message: "This resumes discovery.",
								},
							},
						],
					},
				];
			},
			async operatorAction(event) {
				// Record the decision somewhere discover() can see it —
				// a file, a label, a database row. Do not mutate hidden state
				// and hope; the next discover() is the authority.
				console.log(`${event.actionId} by operator`, event.comment);
			},
		};
	},
});
```

Plot records the choice as an Operator Observation and calls the optional `operatorAction` hook. The hook is bookkeeping or an idempotent integration write; the next `discover` decides what the choice actually means for the work.

## Lifecycle hooks

The runtime may implement `started`, exhaustive `finished`, `operatorAction`, and `shutdown` — signatures and timing are in the SDK declarations. They exist for bookkeeping around Plot-owned execution: logging, metrics, stamping domain state. Cleanup and active-run bookkeeping are protected even when hooks fail.

Do not use hooks to launch nested agents, re-dispatch work, or replace discovery with hidden state transitions.

## Production checklist

- Work is derived from an authoritative system; restarting the process loses nothing.
- Stable `id`, revision-based `version`; done work disappears instead of being flagged.
- Observation failures throw; `[]` is only ever a true statement.
- `waiting` / `blocked` / `cancelled` / absence are each used for their meaning.
- `parseConfig` validates the Workflow config boundary; external responses are validated where they enter.
- Mutation tools are idempotent, identity-guarded, and abortable.
- `context` stays compact; large payloads load through tools.
- Concurrent file-mutating work gets absolute, isolated `workspace` directories.
- Pure decision logic (eligibility, parsing) lives in plain functions with focused tests, like `eligibility.ts` in `examples/pr-review`.
- No Plot internals, no custom dashboard components, no second scheduler, no nested Agent Sessions.
