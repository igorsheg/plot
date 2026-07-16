# Programmatic Plot

Use `createPlot()` when application code should own Plot in the current Node process. Use `plot start` when a Session must be managed by the CLI and outlive the terminal that launched it.

The programmatic path is value-only:

- the Workflow and Extension are TypeScript values;
- system-prompt resources are literal strings;
- provider credentials are explicit values;
- Session events, Agent transcripts, settings, auth, and Extension credentials stay in memory;
- Plot does not read `WORKFLOW.md`, discover `.plot` resources, reuse CLI login state, start the daemon, or spawn the native binary.

`cwd` is only the execution root for Agent tools. Plot does not scan it for configuration. Trusted Extensions and Agent tools may still perform intentional file, process, and network I/O.

## Complete example

```ts
import { createPlot } from "plot-ai";
import {
	defineExtension,
	defineWorkflow,
	type ExtensionWork,
} from "plot-ai/sdk";

interface Queue {
	listOpen(): Promise<readonly ExtensionWork[]>;
}
declare const queue: Queue;
declare const applicationShutdown: Promise<void>;

const extension = defineExtension<{ queue: Queue }>({
	id: "queue-reviewer",
	create: ({ config }) => ({
		async discover() {
			return await config.queue.listOpen();
		},
	}),
});

const workflow = defineWorkflow({
	name: "review-queue",
	agent: {
		provider: "anthropic",
		model: "claude-sonnet-4-6",
	},
	resources: {
		systemPrompt: "Review changes conservatively and verify every claim.",
	},
	extension: {
		use: extension,
		config: { queue },
		maxConcurrentRuns: 2,
	},
	plot: { tickIntervalMs: 60_000 },
	prompt: "Review {{ work.title }} and report only verified findings.",
});

const plot = await createPlot({
	cwd: process.cwd(),
	credentials: {
		anthropic: {
			type: "api-key",
			apiKey: process.env["ANTHROPIC_API_KEY"]!,
		},
	},
});
const session = await plot.start(workflow);
const observation = session.observe();
const unsubscribe = observation.subscribe(() => {
	const state = observation.getSnapshot();
	console.log(state.status, state.workItems, state.agentRuns);
});

try {
	// Plot ticks immediately and continues automatically.
	await applicationShutdown;
} finally {
	unsubscribe();
	observation.close();
	await plot.dispose();
}
```

The example assumes `queue` and `applicationShutdown` are application-owned values.

## Lifecycle

`plot.start(workflow)` is idempotent for the exact Workflow value while its Session is active. Stopping and starting it again creates a fresh Session with fresh in-memory history.

Plot ticks immediately after start and at the Workflow cadence. `session.tick()` is an optional “reconcile now” control for tests and deterministic integrations; it does not wait for newly admitted Agent Runs to finish.

A Workflow is continuous, so there is no terminal Workflow result or `run()` API. An empty discovery result means no work is currently present, not that the Session completed.

Call `session.stop()` to stop one Workflow or `plot.dispose()` to stop everything owned by the Plot instance. Disposal is idempotent and clears in-memory credentials. Dropping a JavaScript reference is not disposal.

An active in-process Session keeps Node alive. `createPlot()` installs no signal handlers; the application decides when SIGINT or SIGTERM should call `plot.dispose()`.

## Source and Operator actions

Source requirements can expose setup actions such as connecting an account. Select one from the current snapshot by stable ids:

```ts
import type { Session, SessionObservation } from "plot-ai";

declare const observation: SessionObservation;
declare const session: Session;

const snapshot = observation.getSnapshot();
const source = snapshot.sources.find(
	(item) => item.readiness === "action-required",
);
const requirement = source?.requirements.find(
	(item) => item.status === "action-required",
);
const action = requirement?.actions?.find(
	(item) => item.disabledReason === undefined,
);

if (source && requirement && action) {
	const result = await session.startSourceAction({
		sourceId: source.sourceId,
		requirementId: requirement.id,
		actionId: action.id,
	});
	if (result.accepted) console.log("action run", result.actionRunId);
}
```

Progress and structured interactions appear under `source.action` in later observation snapshots. The application decides how to present an `open-url` interaction. Cancel an active setup with `session.cancelSourceAction(actionRunId)`.

Work Items can expose Operator Actions such as approve or ignore:

```ts
import type { Session, SessionObservation } from "plot-ai";

declare const observation: SessionObservation;
declare const session: Session;

const work = observation
	.getSnapshot()
	.workItems.find((item) => item.status === "blocked");
const action = work?.actions?.find((item) => item.disabledReason === undefined);

if (work && action) {
	const accepted = await session.performOperatorAction({
		sourceId: work.sourceId,
		workKey: work.workKey,
		actionId: action.id,
		comment: "Approved by policy check",
	});
	console.log("accepted", accepted);
}
```

Callers provide only stable ids and an optional comment. Plot resolves the authoritative action label and timestamp, rejects disabled or stale actions, and enforces required comments. `confirm` metadata is a presentation hint; calling the explicit method remains the application's decision.

## Authentication and resources

Embedded auth never falls back to `plot auth`, internal auth or settings files, or environment discovery. Pass the credential value explicitly. The caller may obtain that value from an environment variable or secret manager before calling `createPlot()`.

Programmatic Workflow resources currently accept only literal `systemPrompt` and `appendSystemPrompt` text. They do not accept skill paths, prompt paths, package declarations, context-file discovery, or strings that become paths when a file happens to exist.

Extensions remain trusted application code with the process's permissions. In-process hosting is not a sandbox.
