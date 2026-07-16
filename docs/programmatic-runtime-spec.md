# Engineering Spec: In-Process Programmatic Plot

Status: approved design, revised on 2026-07-15 to require value-only programmatic configuration.

## Summary

Plot gains a first-class in-process TypeScript runtime. Application code can define a Workflow as a value, create a process-owned Plot control plane, start its Session, observe it, force a tick when useful, and stop or dispose it without invoking the CLI, starting the Session Manager daemon, communicating over IPC, or resolving a platform binary.

```txt
import { createPlot } from "plot-ai";
import { defineWorkflow } from "plot-ai/sdk";
import reviewer from "./reviewer.extension.ts";

const workflow = defineWorkflow({
	name: "review-acme-prs",
	agent: {
		provider: "anthropic",
		model: "claude-sonnet-4-6",
	},
	resources: {
		systemPrompt: "You are reviewing production changes for Acme.",
	},
	extension: {
		use: reviewer,
		config: { repository: "acme/web" },
		maxConcurrentRuns: 2,
	},
	plot: {
		tickIntervalMs: 300_000,
	},
	prompt: `
Review {{ work.title }}.

Inspect the diff and callers, run relevant checks, and post a review only after verification.
`,
});

const plot = await createPlot({
	// An execution root for Agent tools, not a configuration-discovery root.
	cwd: process.cwd(),
	credentials: {
		anthropic: {
			type: "api-key",
			apiKey: process.env.ANTHROPIC_API_KEY!,
		},
	},
});
const session = await plot.start(workflow);
const observation = session.observe();
const unsubscribe = observation.subscribe(() => {
	const snapshot = observation.getSnapshot();
	console.log(snapshot.status, snapshot.workItems, snapshot.agentRuns);
});

try {
	// Optional: force one immediate reconciliation and dispatch cycle.
	// Plot already ticks automatically after start and at the configured cadence.
	await session.tick();
} finally {
	unsubscribe();
	observation.close();
	await plot.dispose();
}
```

`createPlot()` is the canonical programmatic entry point. It is in-process and caller-owned. It does not secretly connect to the CLI daemon or spawn Plot's native executable. There is no public `connectPlot()` in this work.

The programmatic path is value-only. Plot does not read a Workflow file, load an Extension module by path, discover skills or prompts from directories, read Plot/Pi settings or auth files, or create Plot-owned persistence while preparing or running it. The caller supplies the Workflow, Extension, explicit text resources, and provider credentials as TypeScript values.

The CLI retains its existing file-backed Workflow and resource discovery and its managed worker processes because an explicitly detached CLI Session must outlive the terminal that started it. CLI ingestion and programmatic ingestion both produce the same small typed Workflow plan and enter the same Session runtime, Source reconciliation, scheduler, Agent Run seam, lifecycle rules, events, and errors. The adapters may differ in resource acquisition and hosting; they may not fork execution semantics.

The design is informed by:

- Pi coding agent at commit `c6d8371521fc8357958bb21fd43552c15f46c7f4`, especially `src/main.ts`, `core/sdk.ts`, `core/agent-session-services.ts`, `core/agent-session-runtime.ts`, and the run modes;
- Flue at commit `dbc9b05c71fadc1e8d66457815f7bf637c4dd010`, especially its branded definitions, runtime/client separation, materialized observation API, target adapters, and contract tests.

Plot adopts the relevant ownership patterns, not either project's product model.

## Problem

Plot's runtime can currently be entered only through a Workflow file loaded by a managed Session worker. The public `plot-ai/sdk` package authors Extensions, but application code cannot construct and own Plot itself.

A caller that wants to embed Plot must either:

- shell out to a human CLI and parse its output;
- connect to private Session Manager IPC;
- import internal workspace modules and manually compose a `SessionHost`;
- or duplicate Workflow planning, Source adaptation, event ownership, and shutdown behavior.

None is an acceptable programmatic interface.

Using the installed native binary as the only SDK backend would preserve managed Session lifetime, but it would not be an in-process SDK. It would also make a deployment choice—the CLI daemon—the public programming model. That is the wrong center of gravity.

At the same time, simply exporting `createSessionHost()` would be too low-level. It would expose internal paths, Pi test seams, raw RuntimeEvents, and worker-oriented lifecycle details without owning multiple Workflows or providing a stable public observation model.

Plot needs one public, process-owned control plane above `SessionHost`, and one narrow internal hosting seam so direct and worker execution cannot drift.

## Findings from Pi

Pi's CLI and SDK use the same JavaScript core.

`packages/coding-agent/src/main.ts` describes itself as translating CLI arguments into `createAgentSession()` options. Its startup path:

1. parses CLI and resolves UI-specific policy;
2. calls `createAgentSessionServices()` for cwd-bound resources;
3. calls `createAgentSessionFromServices()` for the Agent Session;
4. calls `createAgentSessionRuntime()` for replacement/lifecycle ownership;
5. hands the resulting `AgentSessionRuntime` to interactive, print, or RPC presentation modes.

The CLI first closes over its fixed arguments, trust policy, and resolved resource paths in a `CreateAgentSessionRuntimeFactory`. `AgentSessionRuntime` stores that factory and reuses it for every replacement. SDK callers build a different closure and pass it to the same owner. There is no subprocess between an SDK caller and `AgentSession`.

The relevant lessons are:

- the CLI is an application adapter, not the runtime;
- creation separates fixed inputs, environment-bound services, session construction, and lifecycle ownership;
- one owner stores a narrow creation factory rather than inheriting CLI acquisition policy;
- SDK callers can provide already-constructed auth, model, settings, resource-loader, and Session Manager capabilities instead of accepting CLI defaults;
- presentation modes consume the same runtime object;
- runtime creation returns diagnostics instead of printing or exiting;
- the session owns event subscription, cancellation, and disposal;
- replacement or disposal invalidates stale session-local resources explicitly.

The further lesson is that sharing the Agent Session core does not require sharing CLI resource acquisition. Pi's default cwd-bound service factory is correct for Plot's CLI adapter, but it is not correct for the value-only adapter if it reloads discovered resources or creates file stores. Plot should construct explicit in-memory Pi services behind `@plot/session` and then rejoin the same Agent Session factory.

Plot should not copy Pi's very broad export surface or expose mutable provider/Agent internals. `@plot/session` remains the only Pi SDK seam.

## Findings from Flue

Flue contributes complementary lessons:

- authoring definitions are branded values constructed through helpers;
- exact definition identity is meaningful inside one configured runtime;
- application-facing observation returns materialized state rather than requiring callers to reduce private wire chunks;
- execution admission, waiting, observation cancellation, and execution cancellation have distinct semantics;
- deployment targets sit behind concrete adapters while sharing runtime behavior;
- duplicated public/wire shapes are protected by assignability and behavior tests;
- public errors are structured rather than parsed from prose.

Plot should not copy Flue's finite Workflow Run model, HTTP exposure, deployment framework, durable-stream protocol, Action API, or pipeline semantics. A Workflow remains a continuous Source-driven configured use, and a Session remains online until explicitly stopped or its owning Plot is disposed.

## Product decisions

### `createPlot()` is in-process and value-only

`createPlot()` constructs Plot's JavaScript runtime in the caller's process. Its programmatic ingestion and owned runtime do not:

- spawn the Plot binary;
- connect to the Session Manager daemon;
- create a Unix socket;
- serialize a Workflow or Extension across a process boundary;
- parse CLI output;
- depend on a supported CLI platform package;
- read or resolve a Workflow file;
- import an Extension from a path;
- scan resource, skill, prompt, context, settings, model, or package directories;
- read Plot or Pi auth/config files;
- infer provider credentials from Plot's CLI configuration;
- or write Session History, Agent Transcripts, Extension credentials, settings, or other Plot-owned state.

All programmatic configuration enters as TypeScript values. `cwd` is only the execution root supplied to Agent Runs and built-in tools; it is never treated as a configuration-discovery root. Plot passes it through without scanning it. Likewise, the caller may choose to obtain a credential from `process.env`, but `createPlot()` receives the resulting value and does not perform environment-based auth discovery itself.

This no-implicit-I/O rule applies to Plot-owned ingestion and runtime infrastructure. A trusted Extension, Source, Agent tool, or caller callback may intentionally read files, execute processes, or use the network as part of the workload. The programmatic API is not a sandbox and cannot make trusted application code memory-only.

| Concern               | `createPlot()`                            | CLI worker                                               |
| --------------------- | ----------------------------------------- | -------------------------------------------------------- |
| Workflow              | branded TypeScript value                  | Workflow file                                            |
| Extension             | direct TypeScript value                   | module source resolved and loaded by the existing loader |
| Agent instructions    | literal strings                           | existing Workflow-relative resource discovery            |
| Pi resources/settings | explicit empty/literal in-memory services | existing cwd/agent-directory discovery                   |
| Provider credentials  | explicit values copied to memory          | existing CLI auth/environment mechanisms                 |
| Extension credentials | memory                                    | existing file-backed store                               |
| Session events        | memory                                    | JSONL Session History                                    |
| Agent Run session     | memory                                    | persistent Agent Transcript                              |
| Hosting               | caller process                            | managed worker process                                   |

The right-hand column is not emulated by the left-hand column. The two paths converge after their inputs have been materialized into the shared typed plan and capabilities.

### The caller owns lifetime

An in-process Session does not outlive its host process. Active Sessions keep the process alive until they are stopped or their owning Plot is disposed.

`plot.dispose()` is exhaustive and idempotent:

1. stop admitting new Workflow starts;
2. stop all owned Sessions concurrently;
3. abort active ticks and Agent Runs through their existing contracts;
4. run Extension shutdown hooks;
5. close observations and event stores;
6. release the process keepalive;
7. resolve only after owned resources have settled.

Dropping a JavaScript reference is not disposal.

### Plot ticks automatically

The user is not responsible for driving the scheduler.

Starting a Session:

1. records `session_started`;
2. starts the Agent;
3. requests an immediate tick;
4. continues ticking at `plot.tickIntervalMs`;
5. also wakes for Agent Run completions, Source actions, Operator Observations, retries, and scheduled wakes.

`session.tick()` remains as an explicit control for tests, development tools, deterministic integrations, and “reconcile now” behavior. It coalesces with an in-flight tick and waits for that tick's reconciliation, dispatch admission, and durable/public state update. It does not wait for admitted Agent Runs to finish.

There is no API requiring callers to write a tick loop.

### No `connectPlot()`

This work adds no public daemon client. Managed Session Manager IPC remains private and version-locked to Plot's own CLI, TUI, and Web Console.

If a future concrete use case requires JavaScript to attach to a Session that outlives the JavaScript process, that is a separate client design with different ownership semantics. It must not complicate or secretly replace the in-process contract.

### No `run()` or terminal Workflow result

A Workflow is continuous. An empty discovery result means current Work Items are done or gone; it does not complete the Session. Therefore the public API uses `start`, `stop`, `tick`, and `observe`, not `run`, `invoke`, `waitForResult`, or `result`.

### Programmatic Workflow identity is process-local

`defineWorkflow()` returns a branded, frozen Workflow value. Within one `Plot` instance, the exact value is the Workflow identity. Starting the same value twice returns the same Active Session. Two separately defined values are different Workflows even if their fields are equal.

This follows Flue's exact-definition pattern and avoids inventing a caller-chosen durable identity for an in-memory runtime.

File-backed CLI Workflow identity remains the canonical absolute Workflow file path. File and value ingestion produce the same `WorkflowPlan` and `PreparedWorkflow` shapes, but their public identity and resource-acquisition rules remain appropriate to their host.

## Goals

1. Application code can define and execute a Workflow entirely in-process from TypeScript values.
2. Programmatic startup performs no implicit Plot-owned file, path, package, resource, settings, or auth discovery.
3. Starting a Session immediately enables Plot-owned automatic ticking.
4. Programmatic and managed Sessions execute the same `SessionHost` core.
5. CLI and SDK lifecycle/cardinality owners use one shared implementation over a narrow hosting seam.
6. Programmatic values and CLI files map directly into one typed Workflow plan and one prepared capability shape.
7. In-memory Session History, Extension credentials, Pi settings/auth, resource catalogs, and Agent Run sessions perform no Plot-owned Session writes.
8. Public observation exposes materialized Plot concepts, not private RuntimeEvents or Pi events.
9. Public runtime methods return values or throw structured errors; they never print, exit, or open UI.
10. `@plot/session` remains the sole owner of the Pi SDK seam and both Pi environment adapters.
11. Importing `plot-ai` does not resolve or spawn a native Plot executable.
12. Importing `plot-ai/sdk` remains lightweight and does not initialize the runtime.
13. CLI resource discovery, detached lifetime, and worker isolation remain unchanged.

## Non-goals

- No public `connectPlot()` or Session Manager client.
- No public daemon lifecycle, IPC, HTTP, worker, history-path, or process API.
- No remote runtime.
- No promise that an in-process Session survives process exit.
- No one-shot Workflow mode or terminal Workflow result.
- No scheduler grant, pipeline, action graph, or workflow-engine DSL.
- No hot reload of a running Workflow value.
- No provider SDK, Pi `AgentSession`, Pi `ModelRuntime`, `AuthStorage`, `ResourceLoader`, or Pi event type in the public API.
- No path-valued programmatic Workflow, Extension, skill, prompt, context, settings, model, or credential configuration.
- No implicit reuse of CLI auth, models, settings, packages, skills, prompts, or context discovery by `createPlot()`.
- No arbitrary caller-supplied Session id.
- No compatibility wrapper around internal `createSessionHost()`.
- No generic dependency-injection or state-machine framework.
- No requirement that CLI dashboards run in-process; managed workers remain intentional isolation.

## Public package shape

The npm package exposes two roles:

```txt
plot-ai       process-owned programmatic runtime
plot-ai/sdk   trusted Workflow and Extension authoring contracts
```

Programmatic runtime:

```txt
import { createPlot, RuntimeError } from "plot-ai";
```

Authoring:

```txt
import {
	defineExtension,
	defineWorkflow,
	defineTool,
} from "plot-ai/sdk";
```

Extensions continue importing only from `plot-ai/sdk`. The root entry does not become a second Extension-authoring barrel.

The root runtime is ordinary Node-compatible ESM. It ships and executes JavaScript directly; it is not a wrapper around the platform executable.

Because the upstream Pi coding-agent package defines the minimum supported Node runtime for the in-process seam, `plot-ai`'s `engines.node` must be raised to at least Pi's supported minimum rather than claiming Node 18 compatibility that the programmatic runtime cannot honor.

## Public authoring contract

### `defineWorkflow()`

Conceptual declaration:

```txt
export interface WorkflowResources {
	/** Complete system-prompt text; never interpreted as a path. */
	readonly systemPrompt?: string;
	/** Additional literal system-prompt fragments; never interpreted as paths. */
	readonly appendSystemPrompt?: readonly string[];
}

export interface Workflow<Config = unknown> {
	readonly name: string;
	readonly agent: AgentConfig;
	readonly plot?: WorkflowConfig;
	readonly resources?: WorkflowResources;
	readonly extension: {
		readonly use: Extension<Config>;
		readonly config?: unknown;
		readonly maxConcurrentRuns?: number;
	};
	readonly prompt: string;
}

export const defineWorkflow = <Config>(
	workflow: Workflow<Config>,
): Workflow<Config>;
```

The concrete value is branded and frozen. Callers treat it as opaque identity after definition.

`extension.config` still passes through the Extension's `parseConfig` boundary. `defineWorkflow()` does not make unvalidated values safe through a generic cast.

The programmatic form uses `extension.use` because it carries a trusted Extension value. The file form retains `extension.source` because it carries a module locator. These are ingestion inputs, not two runtime models.

Programmatic `resources` are deliberately literal and small in the first release. They do not accept skill paths, prompt paths, context-file discovery, package declarations, or “string means path if it exists” behavior. Callers put direct instructions in `systemPrompt`/`appendSystemPrompt`, put per-work facts in Work Item context, and expose capabilities through Extension tools. Value-native skill and prompt contracts may be added later, but path-backed resource discovery remains a CLI adapter concern.

### Shared Workflow plan and prepared capabilities

Both ingestion forms construct the same small typed value directly:

```txt
WorkflowPlan {
  name
  agent policy
  Plot timing policy
  prompt
  Extension value
  parsed Extension config
  max concurrent Agent Runs
  Extension-facing Workflow definition
}
```

The CLI parser validates untrusted YAML before constructing this value. `defineWorkflow()` provides the typed boundary for trusted programmatic code; the value path does not re-decode every field at runtime. Extension `parseConfig` remains the one explicit config boundary.

Preparation pairs the plan with owned capabilities:

```txt
PreparedWorkflow {
  identity
  plan
  AgentSession factory
  ExtensionCredentialStore
  execution paths
}
```

`AgentEnvironment` is a narrow `@plot/session`-owned capability used only to create a Agent Run session. Its concrete adapters are:

- `DiscoveredAgentEnvironment` for CLI workers: existing Workflow-relative paths, resource/package/context discovery, file-backed auth/model/settings inputs, and persistent Agent Sessions;
- `InMemoryAgentEnvironment` for `createPlot()`: explicit literal resources, explicit credentials, in-memory settings/auth/model registry, and in-memory Agent Sessions.

The common plan and `PreparedWorkflow` do not expose Pi types. `SessionHost`, Source adaptation, prompt rendering, scheduling, event ownership, and shutdown depend only on the capability shape and cannot tell whether configuration originally came from a file or a value.

The file adapter may perform I/O while ingesting and materializing CLI resources. The value adapter must be pure with respect to filesystem, path, package, settings, model, and auth discovery. It accepts the branded typed value and copies/references already-materialized capabilities only. It never calls the file adapter as a convenience.

## Public runtime contract

The exact initial surface is intentionally small.

```txt
export interface ProviderCredential {
	readonly type: "api-key";
	readonly apiKey: string;
}

export interface CreatePlotOptions {
	/** Agent tool execution root. Default: process.cwd(). Never scanned by Plot. */
	readonly cwd?: string;
	/** Explicit provider credentials. Default: empty; missing auth rejects start. */
	readonly credentials?: Readonly<Record<string, ProviderCredential>>;
}

export interface Plot {
	readonly start: (workflow: Workflow) => Promise<Session>;
	readonly find: (workflow: Workflow) => Session | undefined;
	readonly sessions: () => readonly Session[];
	readonly dispose: () => Promise<void>;
}

export interface Session {
	readonly id: string;
	readonly workflow: Workflow;
	readonly state: SessionState;
	readonly tick: () => Promise<TickResult>;
	readonly startSourceAction: (
		input: SourceActionInput,
	) => Promise<SourceActionStartResult>;
	readonly cancelSourceAction: (actionRunId: string) => Promise<boolean>;
	readonly performOperatorAction: (
		input: OperatorActionInput,
	) => Promise<boolean>;
	readonly observe: () => SessionObservation;
	readonly stop: () => Promise<void>;
}

export type SessionState =
	| "starting"
	| "online"
	| "stopping"
	| "stopped"
	| "error";
```

`createPlot()` is asynchronous because in-memory model services and owned runtime resources may require asynchronous construction. It does not make file/resource discovery asynchronous by hiding it behind the promise.

The initial credential contract supports explicit API keys. Plot copies them into an in-memory auth store owned by the `Plot` instance and clears that store on disposal. The caller may read environment variables or another secret manager before calling `createPlot()`, but Plot never falls back to CLI auth files or environment discovery when a credential is absent. A missing or unsupported credential is a structured startup error.

`Plot.start()` is idempotent for one exact Workflow value while its Session is active. A stopped Workflow may be started again and receives a fresh Session id and fresh in-memory history.

`Plot.sessions()` returns a snapshot array. Mutating it cannot mutate Plot.

A `Session` handle remains readable after stop for its final state and observation snapshot, but mutable controls reject once stopping begins.

### Tick result

The public tick result contains stable scheduling facts, not internal maps:

```txt
export interface TickResult {
	readonly tickId: number;
	readonly selected: number;
	readonly started: number;
	readonly completed: number;
	readonly activeAgentRuns: number;
	readonly diagnostics: readonly Diagnostic[];
}
```

Naming uses Agent Run rather than bare “run.”

### Observation

Callers consume a materialized Plot projection rather than private RuntimeEvents:

```txt
export interface SessionObservation {
	readonly getSnapshot: () => SessionSnapshot;
	readonly subscribe: (listener: () => void) => () => void;
	readonly close: () => void;
}

export interface SessionSnapshot {
	readonly sessionId: string;
	readonly workflowName: string;
	readonly sequence: number;
	readonly status:
		| "starting"
		| "idle"
		| "running"
		| "stopping"
		| "stopped"
		| "error";
	readonly sources: readonly SourceSnapshot[];
	readonly workItems: readonly WorkItemSnapshot[];
	readonly agentRuns: readonly AgentRunSnapshot[];
	readonly completedWork: readonly CompletedWorkSnapshot[];
	readonly usage: UsageSnapshot;
	readonly diagnostics: readonly Diagnostic[];
}
```

The concrete snapshot types use arrays and readonly plain objects, not mutable Maps. They use the glossary's Source, Work Item, Agent Run, and Session terms. They omit:

- Session history and transcript filesystem paths;
- manager and worker identity;
- private sequence envelopes;
- raw Pi messages and events;
- provider request payloads and reasoning internals not already intentionally projected;
- arbitrary Extension credentials or config.

Observation semantics:

- `observe()` immediately returns an observation over the Session's retained in-memory history;
- `subscribe()` synchronously registers a listener and returns an unsubscribe function;
- `getSnapshot()` is referentially stable until an update is published, making it compatible with `useSyncExternalStore`;
- subscribing after Session start reconstructs all prior state before publishing live updates;
- one slow subscriber cannot create an unbounded authoritative event queue;
- `close()` detaches only that observation and never stops the Session;
- Session stop publishes the final snapshot and closes live observation resources;
- observation errors become snapshot diagnostics or a terminal observation error according to whether authoritative state remains usable.

Private RuntimeEvents remain the internal durable/replay input. The public projection mapper is the sole place that translates them into the supported snapshot contract.

### Typed Source and Operator controls

Source requirement actions and Work Item Operator Actions are represented in `SessionSnapshot` and controlled through `Session`.

`startSourceAction()` selects a Source requirement action by `sourceId`, `requirementId`, and `actionId`. It returns an accepted union containing `actionRunId`; the action's progress, structured interactions, and terminal state appear under the Source snapshot. `cancelSourceAction()` cancels an active action by that run id.

`performOperatorAction()` selects a current Work Item action by `sourceId`, `workKey`, and `actionId`, with an optional comment. Plot resolves the current label from the authoritative Source state and constructs the timestamp. Callers cannot provide either field. Disabled actions, stale actions, and actions missing a required comment are not admitted.

Confirmation metadata is presentation policy. Plot exposes it in the action snapshot, and the caller decides how to obtain confirmation before invoking the explicit control.

## Structured errors

The root package exports one stable base error:

```txt
export class RuntimeError extends Error {
	readonly code: string;
	readonly retryable: boolean;
	readonly context?: Readonly<Record<string, string | number | boolean | null>>;
}
```

Known Workflow validation, Session lifecycle, Source action, capacity, and shutdown errors preserve owner-specific codes. Public code does not parse message text.

Abort caused by a caller-provided signal uses the platform's normal abort error semantics. Aborting observation or an individual wait does not stop the Session. Stopping execution is always an explicit `session.stop()` or `plot.dispose()` operation.

Runtime code never writes errors to stdout/stderr and never calls `process.exit()`. Extension-authored output follows normal in-process stdout/stderr semantics because trusted code shares the caller's process.

## Internal architecture

## 1. Separate ingestion, shared plan and host

File I/O is an outer CLI adapter, not part of shared Session construction and not reachable from the root runtime entrypoint.

```txt
CLI only:
  Workflow YAML -> validate -> load Extension -> discovered Agent factory ─┐
                                                                           ├─> PreparedWorkflow -> SessionHost
Programmatic only:                                                         │
  typed Workflow value -> direct Extension -> in-memory Agent factory ─────┘
```

There is no generic decoder between trusted TypeScript and `WorkflowPlan`. The CLI keeps strict validation because YAML and loaded modules cross an untyped boundary. Programmatic code is already typed and trusted; preparation copies its fields, calls Extension `parseConfig`, and builds the in-memory capabilities.

Enforce dependency direction in modules, not only by convention:

- `host.ts` accepts `PreparedWorkflow` and imports no ingestion adapter;
- `host-file.ts` and `preparation.ts` own CLI file/Jiti loading;
- `workflow-value.ts`, `agent-session-memory.ts`, and memory stores own the value path;
- the root runtime imports only the common host and Workflow-value modules.

Do not serialize a programmatic Extension, dynamically write a temporary Workflow file, synthesize fake resource paths, or route direct values through Jiti. Direct values remain direct. A string programmatic resource is always content and is never tested with `exists()` to decide whether it is a path.

`plot check` continues using file ingestion and requirement checking without discovery or actions. `createPlot().start()` uses direct values. Both then use the same `PreparedWorkflow`, Extension setup, `SessionHost`, Source adapter, scheduler, and events.

## 2. `SessionHost` remains the execution composition root

`packages/session/src/host.ts` already composes:

- a prepared Workflow and Agent Session factory;
- Extension runtime and Source adapter;
- Session event ownership;
- Agent runner;
- Agent;
- SessionRuntime;
- ordered shutdown.

Refactor `createSessionHost()` to accept an owned `PreparedWorkflow`; it must not load a Workflow, resolve paths, discover resources, or choose persistence itself. Keep a CLI-only file-ingestion wrapper in the worker path. The programmatic package imports the value-ingestion wrapper only.

The worker and in-process SDK both end at this same function. Neither may reproduce its wiring. `SessionHost` receives one `@plot/session`-owned Agent Session factory prepared by its adapter.

## 3. One factory-injected lifecycle owner

Follow Pi's `AgentSessionRuntime` pattern: the owner stores one creation factory, while each environment resolves its own target and closes over its own acquisition policy. Neither environment owns a parallel lifecycle registry.

```txt
value target ────> value/in-process factory ───┐
                                                ├─> createOwner() ─> SessionSlot
managed target ──> worker factory ──────────────┘
```

`Owner` receives an opaque `SessionTarget` containing its canonical key, aliases, and environment-specific target value. Its stored `CreateSessionFactory` produces an `OwnedSession`; the only lifecycle capability required from that Session is `close(context)`.

The value factory closes over explicit credentials, memory stores, Workflow-value preparation, and direct `SessionHost` construction. The managed factory closes over worker spawning, IPC, durable stores, and process shutdown policy. The child still constructs the same `SessionHost`.

The shared owner retains:

- one Active Session per Workflow identity;
- alias-to-identity ownership;
- start/start coalescing;
- start/stop and stop/start ordering;
- control admission by Session state;
- failure teardown;
- exhaustive disposal;
- closed-owner admission errors.

Environment adapters retain presentation, summaries, event transport, persistence, diagnostics, and process policy. `createPlot()` and `SessionManager` both compose `createOwner()` directly; neither calls or wraps the other. The CLI's private IPC remains outside this owner.

## 4. In-memory Session state

Introduce a narrow Session event store used by the existing event owner:

```txt
interface SessionEventStore {
	append(event: RuntimeEvent): Promise<void>;
	read(after?: number): AsyncIterable<RuntimeEvent>;
	close(): Promise<void>;
}
```

Concrete implementations:

- memory store for `createPlot()`;
- JSONL store for managed Sessions.

Both implementations pass one behavior contract for ordering, replay frontier, close, malformed input boundaries where applicable, and append-after-close rejection.

Session event ownership remains:

1. allocate sequence;
2. append to the selected store;
3. update the internal projection;
4. publish live;
5. resolve the durability/visibility fence.

For memory storage, “durable” means committed to the owner before publication; it does not claim process-crash durability.

The memory store is bounded. When retained history reaches its bound, it must retain enough canonical projected state to hydrate a new observation and preserve all state needed for correct future reduction. It must not silently drop authoritative events while still claiming replay from sequence zero.

The simplest acceptable first implementation may retain all events under a fixed hard Session limit and fail the Session explicitly when exceeded. Do not introduce compaction until a real retained-state contract is defined.

## 5. In-memory Agent environment

The programmatic adapter creates the complete Pi environment in memory behind `@plot/session`:

- `SessionManager.inMemory()` for Agent Run transcripts;
- `SettingsManager.inMemory()` with Plot-owned defaults;
- `AuthStorage.inMemory()` populated only from `CreatePlotOptions.credentials`;
- `ModelRegistry.inMemory()` over that auth store and Pi's built-in model catalog;
- an `InMemoryResourceLoader` that returns the Workflow's literal system-prompt values and empty Extension, skill, prompt-template, theme, package, and context-file catalogs.

The in-memory adapter must not call `createAgentSessionServices()` if that factory necessarily constructs `DefaultResourceLoader` and reloads cwd-bound resources. It may use `createAgentSessionFromServices()` only after constructing services whose storage and resource loader are demonstrably memory-backed, or use an equally narrow upstream factory. This Pi-specific construction remains private to `@plot/session`.

`cwd` is still passed to the Agent Session so built-in coding tools have an execution root. No Plot or Pi resource reload/discovery is run against it. File activity initiated later by an Agent tool is workload behavior, not programmatic configuration discovery.

Managed workers retain their existing discovered/file-backed Pi environment and persistent Agent Transcript files. Both environment adapters must pass one Plot-owned Agent Session factory contract covering model selection, tool admission, prompt resources, activity events, cancellation, and disposal. Programmatic snapshots expose intentionally projected transcript/activity data, never Pi storage identities or paths.

## 6. In-memory credentials

Programmatic Plot has two distinct in-memory credential stores:

- provider credentials copied from `CreatePlotOptions.credentials` into the private Pi auth seam;
- Extension credentials exposed through `ExtensionCredentials`.

Both live for the owning `Plot` lifetime and are cleared on disposal. Neither falls back to Plot/Pi files, environment lookup, a keychain, CLI login state, or provider settings. Missing credentials fail with a structured, non-secret error naming only the provider and phase.

Managed CLI workers continue using existing auth and Extension credential behavior. Session persistence, provider authentication, and Extension credentials remain separate concerns even though all three are memory-backed programmatically.

## 7. Automatic scheduler lifetime

Today Agent timers are unref'ed because managed workers remain alive through IPC. An in-process Plot must not accidentally exit while it owns an online Session.

The lifecycle owner therefore holds one referenced process keepalive while at least one in-process Session is starting, online, or stopping. It releases the keepalive when no Active Session remains or Plot is disposed.

The keepalive does not perform ticks. The existing Agent scheduler remains the sole tick owner.

No process-global signal handlers are installed by `createPlot()`. The embedding application decides how SIGINT/SIGTERM map to `plot.dispose()`.

## 8. Observation ownership

`@plot/projection` continues reducing private RuntimeEvents. Add one public mapper from the internal dashboard projection to `SessionSnapshot`.

Do not make Web/TUI presentation types the public API merely by exporting them. Public names and fields follow Plot's glossary and omit terminal mechanics.

The in-process observation flow is:

1. subscribe to Session live delivery;
2. hydrate from the Session event store or retained canonical projection;
3. reduce any buffered suffix without duplication;
4. map to an immutable public snapshot;
5. notify listeners;
6. continue live until close or Session termination.

This is the same history-to-live correctness rule already required of managed Session continuation, without a transport boundary.

## 9. Managed worker parity

Worker hosting retains:

- trusted Extension isolation from the Session Manager;
- native Bun child IPC;
- bounded diagnostics;
- command timeouts;
- graceful/TERM/KILL shutdown escalation;
- detached lifetime;
- private manager identity handshakes.

These are hosting concerns. They must not change the shared Workflow plan, Extension/Source semantics, Agent Run scheduling, public snapshots, or lifecycle admission. Resource acquisition intentionally differs before `PreparedWorkflow`: CLI discovers files and configuration; programmatic callers provide values.

Run the same shared lifecycle contract against in-process and worker hosts. Keep worker-specific tests only for transport, diagnostics, process exit, and escalation.

## 10. Drift prevention is structural

“No drift” does not mean forcing value inputs through file loaders or pretending both environments acquire resources identically. It means the differences end at narrow typed boundaries before execution begins.

Protect that property with four layers:

1. **Dependency direction:** the common host imports neither file nor value ingestion; both adapters depend on the same `WorkflowPlan` and `PreparedWorkflow` types.
2. **Plan contract:** equivalent CLI and programmatic definitions produce equal execution-relevant plans, excluding identity and adapter-owned acquisition metadata.
3. **Capability contracts:** discovered and in-memory Agent factories, event stores, credential stores, and host drivers each pass the same owner-level behavior suite.
4. **End-to-end event parity:** given equivalent prepared plans and fake external boundaries, both hosts produce the same ordered RuntimeEvents, tick results, Source outcomes, public snapshots, and shutdown order.

Any new execution-relevant Workflow option must be added to `WorkflowPlan` and mapped by both ingestion adapters or explicitly rejected by one adapter. Neither adapter may add a private scheduling default. CLI-only acquisition options stay outside the plan once materialized.

## State and ownership

### Owner lifecycle

```txt
type OwnerLifecycle =
  | { state: "open" }
  | { state: "disposing"; done: Promise<void> }
  | { state: "disposed" };
```

Starting after disposal rejects. Concurrent disposal shares one promise.

### Programmatic Workflow slot

```txt
type WorkflowSlot =
  | { state: "idle" }
  | { state: "starting"; operation: Promise<Session> }
  | { state: "online"; session: OwnedSession }
  | {
      state: "stopping";
      session: OwnedSession;
      operation: Promise<void>;
    };
```

The exact representation may differ, but start/start, start/stop, stop/start, and stop/stop outcomes match the managed Session Manager contract.

Stopped slots can be removed because exact Workflow values remain available to callers and historical Session listing is not part of the first in-memory API.

### Session lifecycle

The public state is derived from one internal owner. Do not coordinate separate booleans for started, closing, closed, and error.

A Session owns:

- SessionHost driver;
- current lifecycle state;
- Workflow value;
- public observation projection;
- active observation handles;
- terminal error if any;
- stop promise.

## CLI and SDK responsibilities

### Shared core responsibilities

- the typed Workflow plan and prepared capability shape;
- Extension config parsing and setup;
- the Agent Session factory capability contract;
- Source requirements, discovery, reconciliation, retry, and actions;
- tick scheduling and wakeups;
- Agent Run execution and continuation;
- event ordering and projection;
- lifecycle admission;
- structured errors;
- shutdown order.

### CLI-only responsibilities

- argument parsing and help;
- Workflow file reading and Extension module loading;
- Workflow-relative path resolution;
- package, skill, prompt, context, settings, model, and auth discovery;
- materializing `DiscoveredAgentEnvironment`;
- human output and prompts;
- auth UI;
- Session Manager daemon startup;
- worker process hosting;
- TUI/Web attachment;
- detach semantics;
- process signals;
- native executable packaging.

### Programmatic-only responsibilities

- accepting a branded Workflow value;
- direct Extension and literal resource values;
- explicit provider credential values;
- materializing `InMemoryAgentEnvironment` without discovery;
- process-owned lifecycle;
- memory Session state;
- materialized observation handles;
- returning values and errors without output.

## Security and trust

An in-process Extension is trusted application code. It has the caller's process permissions and can mutate process globals, access environment variables, read files, open sockets, and write stdout/stderr. `createPlot()` is not a sandbox.

The managed CLI retains worker isolation to protect manager control traffic and daemon lifetime from accidental Extension behavior. This is operational isolation, not a security sandbox.

Public snapshots and structured errors must not include:

- provider credentials;
- Extension credentials;
- full Workflow config by default;
- raw environment variables;
- private manager/build identity;
- arbitrary exception objects;
- unbounded prompts or tool payloads.

Extension-provided Work Item context remains available to the Agent prompt but is not automatically copied into the public snapshot.

## Package and release design

Add a Node ESM runtime build for the root `plot-ai` export:

```json
{
	"exports": {
		".": {
			"types": "./lib/index.d.ts",
			"import": "./lib/index.js"
		},
		"./sdk": {
			"types": "./lib/sdk.d.ts",
			"import": "./lib/sdk.js"
		}
	}
}
```

The runtime bundle includes Plot workspace code needed by `createPlot()` and declares the actual upstream runtime dependencies needed under Node. Its root import graph includes the value adapter and shared runtime, but excludes Workflow file/Jiti loading, CLI resource discovery, file auth/settings/session factories, worker/manager modules, and platform package resolution.

Release smoke tests run a fresh Node consumer against the packed umbrella package and prove:

- `import { createPlot } from "plot-ai"` succeeds without invoking the CLI;
- a programmatic Workflow starts and ticks automatically;
- disposal completes without hanging;
- no manager socket or daemon state is created;
- no platform binary is spawned;
- no Workflow, Extension, resource, settings, auth, model, context, or package path is read or scanned by Plot;
- no Plot-owned file is created under `cwd`, `HOME`, or the package directory;
- missing explicit credentials fail instead of falling back to CLI or environment auth discovery;
- `plot-ai/sdk` still imports independently;
- the CLI binary and existing Extension loading still work.

Programmatic runtime support may work on a platform where the compiled CLI is unavailable, provided upstream Node dependencies support it. The postinstall warning for unsupported CLI platforms must not make the root JavaScript runtime unusable.

## Documentation

Add a public `docs/programmatic.md` topic covering:

- when to use in-process Plot versus `plot start`;
- caller-owned lifetime;
- automatic ticks and the optional manual tick;
- programmatic Workflow definition;
- observation;
- explicit stop/dispose;
- trusted in-process Extension behavior;
- explicit in-memory credentials and the absence of CLI auth fallback;
- literal resource values and the absence of path/resource discovery;
- the distinction between no implicit Plot I/O and intentional Extension/tool I/O;
- the absence of a terminal Workflow result.

Update:

- `README.md`;
- `packages/npm/plot-ai/README.md`;
- `docs/index.md`;
- `docs/guide.md` where programmatic authoring belongs;
- `docs/docs.json`;
- shipped examples and release manifests.

Add one complete `examples/programmatic/` example. It must use automatic ticking in its main path; manual `tick()` may be shown separately as an optional deterministic control.

`plot docs sdk` remains the authoritative authoring declarations. Add `plot docs programmatic` for runtime guidance rather than printing the larger runtime declaration bundle as prose.

## Implementation sequence

Each phase ends with `bun run check`. Release-facing phases also run:

```bash
bun run release:local --version 0.0.0-test --skip-check
```

### Phase 1: value ingestion and shared plan

- Add branded `defineWorkflow()` to `@plot/sdk`.
- Define the programmatic Workflow with direct Extensions and literal-only Agent resources.
- Introduce the small `WorkflowPlan` and `PreparedWorkflow` types used by the common host.
- Keep strict decoding in the existing CLI file boundary; map typed programmatic values directly.
- Keep `plot check` and worker startup on file ingestion.
- Split the common host from its file wrapper so the programmatic path cannot reach Jiti/resource-discovery modules.

Exit condition: equivalent file and value inputs produce the same typed plan, while value ingestion performs no path/file discovery and accepts no path-valued resource fields.

### Phase 2: memory-owned Session and Agent environment

- Introduce the Session event store seam.
- Implement memory and JSONL stores under one behavior contract.
- Add in-memory Extension credentials and explicit in-memory provider credentials.
- Add the private in-memory Pi settings, auth, model-registry, resource-loader, and Agent Session adapters.
- Keep existing discovered/file-backed Pi services in the CLI adapter.
- Run one Agent Session factory contract against both environments.
- Make `SessionHost` accept a prepared Workflow and explicit capabilities/stores only.

Exit condition: a direct `SessionHost` can execute a Workflow without reading Plot/Pi configuration or resources and without writing Session History, Agent Transcripts, settings, auth, or Extension credentials.

### Phase 3: shared hosting and lifecycle

- Extract the narrow SessionHost driver used by lifecycle/cardinality ownership.
- Implement in-process and worker drivers.
- Move common start/stop/control admission out of worker-specific manager code.
- Run one lifecycle contract against both hosts.
- Preserve worker diagnostics and escalation in worker-only code.

Exit condition: after ingestion has produced `PreparedWorkflow`, direct and managed hosting differ only in concrete hosting/storage/Agent-environment capabilities, not Workflow, Source, scheduler, event, or lifecycle behavior.

### Phase 4: public `createPlot()` runtime

- Implement Plot and Session lifecycle owners.
- Start automatic scheduler operation on `plot.start()`.
- Keep the process alive while in-process Sessions are active.
- Implement manual `tick()` as an optional coalesced control.
- Implement exhaustive `stop()` and `dispose()`.
- Add structured public errors.

Exit condition: a caller can start multiple Workflows, observe automatic work dispatch, manually tick, stop one Session, and dispose all resources in-process.

### Phase 5: materialized observation

- Define curated public snapshot types.
- Map internal projection to public Plot concepts.
- Implement history-to-live observation with bounded subscribers.
- Add Source and Operator controls only with exact public action types.
- Prove observation close never stops execution.

Exit condition: application code can build a UI or automation over snapshots without importing RuntimeEvent, Pi, projection, or Session Manager types.

### Phase 6: package, documentation, and release

- Build and export the root Node ESM runtime.
- Publish required runtime dependencies and correct Node engine.
- Add programmatic docs and example.
- Add packed-package Node smoke coverage.
- Confirm the root runtime import graph excludes file ingestion, resource discovery, workers, the daemon, and native binary resolution.
- Confirm importing/running the SDK does not resolve or spawn a native binary.

Exit condition: the packed `plot-ai` package supports both the CLI and a real value-only in-process Node consumer.

## Behavior tests

### Automatic execution

- `plot.start(workflow)` schedules an immediate tick without `session.tick()`.
- periodic ticks continue at the Workflow cadence.
- Agent Run completion requests reconciliation without caller intervention.
- retry and scheduled wake timers trigger ticks automatically.
- manual `tick()` coalesces with an in-flight automatic tick.
- manual `tick()` does not wait for admitted Agent Runs to finish.

### Value-only programmatic boundary

- a programmatic Workflow starts when `cwd` and `HOME` contain intentionally invalid Workflow, Plot, Pi, auth, settings, package, skill, prompt, and context files;
- no Workflow or Extension module loader is called by value ingestion;
- path-looking `systemPrompt` and `appendSystemPrompt` strings remain literal content and are never read;
- programmatic authoring rejects CLI-only `extension.source`, skill paths, prompt paths, context discovery, and package fields;
- an environment or CLI auth credential alone does not satisfy programmatic auth; the explicit credential map does;
- in-memory Pi settings, auth, model registry, resource loader, and Agent Session factories perform no file writes;
- a caller/Extension/tool may still perform intentional I/O without Plot misclassifying it as discovery;
- equivalent file and value definitions produce equal scheduling/prompt/Extension plans;
- the programmatic import graph has no edge to file ingestion, Jiti, CLI discovery, worker, manager, or platform resolution modules.

### Workflow identity and lifecycle

- starting the same Workflow value concurrently creates one Active Session;
- starting two different Workflow values using one Extension creates independent Sessions;
- stopping and restarting one Workflow creates a fresh Session;
- start during stop waits and creates a fresh Session;
- stop during start stops the admitted Session;
- controls reject after stopping begins;
- starting after Plot disposal rejects;
- concurrent disposal shares one operation.

### Shared host parity

Run one contract against in-process and worker hosts proving:

- requirement readiness gates discovery;
- reconcile precedes dispatch;
- Work Item disappearance drains;
- cancellation interrupts;
- Agent Run completion is admitted once;
- retry behavior and reset match;
- Source actions and Operator Observations wake reconciliation;
- Session event order and public projection match;
- shutdown runs Agent, Source, Extension, and event cleanup in the same order;
- owner errors retain the same code and safe context.

### In-memory ownership

- no Session History file is created;
- no Agent Transcript file is created;
- no Extension credential file is created;
- no Pi auth, settings, models, resource, package, context, skill, or prompt file is read or created;
- provider credentials are copied into memory and cleared on disposal;
- a late observation reconstructs state from memory;
- retained event capacity has an explicit tested failure or compaction outcome;
- append after close rejects;
- disposing clears credential and event stores.

### Observation

- snapshots use Source, Work Item, Agent Run, and Session terminology;
- `getSnapshot()` is stable between updates;
- a late subscriber observes earlier automatic ticks;
- unsubscribe removes only one listener;
- close detaches without stopping the Session;
- slow subscribers remain bounded;
- final stop publishes a terminal snapshot;
- snapshots contain no internal paths or credentials.

### Process ownership

- an Active in-process Session keeps Node alive;
- stopping the final Session releases the keepalive;
- `plot.dispose()` releases every process-owned handle;
- `createPlot()` installs no signal handlers;
- Extension stdout/stderr remains ordinary caller-process output;
- no child process or manager daemon is spawned.

### Packaging

- root runtime and `plot-ai/sdk` import independently;
- the packed Node runtime executes a minimal automatic-tick Workflow from direct values and explicit credentials;
- root runtime works without reading a platform package or CLI configuration/resources;
- CLI package resolution and commands remain unchanged;
- public declarations expose no workspace, Pi, worker, manager, history, or projection type.

## Mechanical checks

After the implementation, these searches should have intentional results only:

```bash
rg 'connectPlot|createPlotClient' packages docs examples README.md
rg 'SessionManagerClient|RuntimeEvent|SessionProcess|historyPath' \
  packages/runtime packages/npm/plot-ai/lib
rg '@earendil-works/pi' packages/runtime/src packages/sdk/src
rg 'workflow-file|jiti|DefaultResourceLoader|createAgentSessionServices' \
  packages/runtime packages/session/src/{workflow-value,agent-session-memory}.ts
rg 'readFile|readdir|realpath|existsSync|SessionManager\.create|AuthStorage\.create|SettingsManager\.create' \
  packages/runtime packages/session/src/{workflow-value,agent-session-memory}.ts
rg '\bBun\b' packages/runtime packages/agent packages/session packages/sdk packages/common
rg 'setInterval|requestTick' packages/runtime
```

Expected interpretation:

- no public `connectPlot` or `createPlotClient`;
- no internal manager/runtime event types in generated public declarations;
- no Pi imports outside `@plot/session` in new runtime code;
- no file-ingestion, Jiti, default resource-discovery, or cwd-bound Pi service factory in the programmatic import graph;
- no direct filesystem discovery or file-backed Pi store constructor in programmatic modules;
- no Bun dependency in the in-process runtime path;
- automatic tick ownership remains in `@plot/agent`, not duplicated by `createPlot()`.

## Acceptance criteria

The work is complete when all of the following are true:

1. `createPlot()` runs entirely in the caller's process.
2. It never resolves, spawns, or communicates with the Plot native binary.
3. Programmatic Workflows carry direct Extension and literal resource values and require no Workflow, Extension, or resource paths.
4. Programmatic ingestion and owned runtime infrastructure perform no implicit file, package, settings, model, resource, or auth discovery.
5. Programmatic provider auth, Pi settings/model services, Session state/history, Extension credentials, and Agent Run sessions are memory-owned.
6. `cwd` is used only as the Agent tool execution root and is never scanned for configuration by Plot.
7. Starting a Session immediately enables automatic ticks.
8. Manual `tick()` remains optional and deterministic.
9. The same `WorkflowPlan`, `PreparedWorkflow`, and `SessionHost` execute programmatic and managed Sessions.
10. One shared lifecycle owner enforces start/stop/cardinality semantics across direct and worker hosts.
11. CLI file/resource ingestion remains outside the shared runtime and unchanged in behavior.
12. Active Sessions keep the host process alive until explicit stop/dispose.
13. `plot.dispose()` is exhaustive, bounded, idempotent, and clears in-memory credentials.
14. Public observation exposes immutable materialized Plot concepts without raw RuntimeEvents or Pi types.
15. No public `connectPlot()`, daemon, manager, worker, remote, path-resource, or Pi service API exists.
16. CLI detached Session behavior and worker isolation remain intact.
17. Runtime code prints nothing and installs no process signal handlers.
18. Packed-package Node smoke tests exercise a real value-only programmatic Workflow and prove no CLI configuration fallback.
19. `bun run check` passes.
20. `bun run release:local --version 0.0.0-test --skip-check` passes.

## Definition of done

A programmatic user needs to understand only:

1. define an Extension;
2. define a Workflow that uses it and literal prompt resources;
3. create Plot with explicit provider credentials and an optional Agent execution cwd;
4. start the Workflow's Session;
5. observe it while Plot ticks automatically;
6. optionally request an immediate tick;
7. explicitly stop or dispose the process-owned runtime.

They do not need to understand or possess a Workflow file, Extension path, Plot/Pi config directory, discovered skill/prompt/package, CLI login, native binary, daemon, Session Manager, worker IPC, RuntimeEvent envelope, AgentSession, history file, or platform package.
