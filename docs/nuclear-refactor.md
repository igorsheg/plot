# Nuclear refactor: one durable Plot

Status: approved design for a breaking, pre-production refactor.

This refactor removes Plot's one-shot product, public process registry, public event stream, and public Session protocol. Plot becomes one thing: a control plane that runs durable, Source-driven Workflows and lets operators attach through the terminal dashboard or Web Console.

There is no compatibility period. Delete old commands, types, routes, docs, tests, and implementations in the same change. Do not add aliases, warning shims, deprecated exports, or adapters preserving the old model.

## Goal

Make Plot's public model match its domain model:

```txt
Extension  1 ──► many Workflows
Workflow   1 ──► at most one active Session
Session    1 ──► many Work Items
Work Item  1 ──► many sequential Agent Runs
```

An Extension is reusable trusted TypeScript. A Workflow configures that Extension for one use: integration configuration, prompt, agent policy, and scheduling. For example, the same PR-review Extension can back separate Workflows for different repositories, prompts, and model policies.

A Session is always durable and managed. Dashboards attach to it. Leaving a dashboard does not stop it. Only an explicit stop does.

Success means fewer concepts, fewer public interfaces, and materially less code—not the same implementation hidden behind renamed commands.

## Product invariants

### Workflow identity

A Workflow is identified by the canonical absolute path of its Workflow file:

1. Resolve the CLI path against the invocation working directory.
2. Resolve `.` and `..` segments and symlinks with the platform's canonical path operation.
3. Use that canonical path as the internal Workflow key.

Equivalent spellings of the same file select the same Workflow:

```bash
plot
plot WORKFLOW.md
plot ./WORKFLOW.md
plot /absolute/project/WORKFLOW.md
```

The canonical path is internal. User-facing surfaces show the Workflow name and path, not a hash or UUID.

Moving a Workflow file creates a different Workflow identity. Editing it does not. An active Session keeps the Workflow definition loaded at Session start; changes apply after stop and restart. Plot does not hot-reload Workflow or Extension code in this refactor.

### Session cardinality

At most one active Session may own a Workflow key.

`start` is atomic at the Session Manager. Concurrent attempts to start the same Workflow either receive the same active Session or one starts it and the others attach to the result. This invariant must not be implemented as a CLI-side list-then-start race.

The rule is per Workflow, not per Extension. These may run concurrently:

```txt
workflows/acme-pr-review.md  ─┐
                              ├─ extensions/pr-review.extension.ts
workflows/plot-pr-review.md  ─┘
```

A Workflow may have many historical Sessions over time, but only one active Session.

### Lifecycle

- A Session starts in the background under the Session Manager.
- A Session survives terminal-dashboard and Web Console disconnection.
- Reopening the same Workflow attaches to its active Session.
- Stopping is explicit and idempotent.
- Stopping drains through the existing Session shutdown contract, then terminates the worker if bounded graceful shutdown expires.
- An unexpected worker exit marks the Session as errored and releases the Workflow key.
- Starting the Workflow again after stop or error creates a new Session and history file.

### Source requirement

Every Workflow must configure an Extension that contributes a Source. Extensionless Workflows are invalid.

Plot no longer synthesizes `workflow:default`, a Work Item, or completion state for a Markdown prompt. A user who wants one external item models that item in a Source. Plot does not contain a second scheduler mode for this case.

### Internal versus public interfaces

Runtime events, durable Session History, worker IPC, and HTTP/SSE remain implementation tools for Plot's own dashboards. They are not public compatibility contracts.

Only `plot-ai/sdk` is a supported programming interface. Everything under internal workspace packages and every Web Console route may change with Plot itself.

## Public CLI

The complete intended command map is:

```txt
USAGE
  plot [workflow]          Start or attach, then open the terminal dashboard
  plot start [workflow]    Start a Session without attaching
  plot stop [workflow]     Stop the Workflow's active Session
  plot web                 Open the Web Console

AUTHORING
  plot check [workflow]    Validate Workflow, Extension, Source, and model readiness
  plot docs [topic]        Read bundled documentation

ACCOUNT
  plot auth                Manage provider credentials
  plot models [query]      List available models
```

The default Workflow path is `WORKFLOW.md`.

Advanced implementation tuning is not part of root help. Runtime capacities and timing belong in Workflow configuration. Auth paths may remain test seams in internal functions, but must not dominate public help.

### `plot [workflow]`

1. Canonicalize and check the Workflow.
2. Ask the Session Manager to start-or-get its Session.
3. Attach the terminal dashboard.
4. Replay enough durable Session History to construct the current projection, then follow live events without a gap.
5. On `q` or Ctrl-C, request explicit stop confirmation; confirm stops the Session.
6. On `d`, terminal loss, or UI failure, detach only. An explicit detach warns that token use may continue and prints the exact stop command.

The command must never stop a Session without confirmed operator intent.

If readiness requires an Operator Action, open the dashboard with the Source in `Needs You`; do not instruct users to run a separate setup command. If the Workflow cannot load at all, or no usable model/auth configuration exists, fail before reserving the Workflow key and print one actionable diagnostic.

### `plot start [workflow]`

Start-or-get the Workflow's Session and return after it is online.

Human output:

```txt
Started acme-pr-review
```

or:

```txt
Already running acme-pr-review
```

Do not print an internal Session ID as the primary result. This command is for shells and supervisors, not a replacement machine protocol.

### `plot stop [workflow]`

Resolve the Workflow key and stop its active Session. It is idempotent:

```txt
Stopped acme-pr-review
```

or:

```txt
acme-pr-review is not running
```

The Session Manager, not the CLI, owns process lookup and shutdown.

### `plot web`

Start or connect to the local Fleet Web Console and open it in the browser. The console lists active and historical Sessions and can start a configured Workflow selected by the operator.

`plot web` is not scoped to one Workflow. It does not silently create a Session. Host and port overrides may exist under `plot web --help` for local development and supervised deployments; they do not appear in root help.

The Web Console process is infrastructure for the UI, not a Session. Closing its launcher must not stop Sessions.

### `plot check [workflow]`

Perform side-effect-free validation:

- parse the Workflow;
- require `extension.source`;
- load the Extension;
- parse Extension configuration;
- construct its runtime;
- inspect Source requirements without invoking actions or discovery;
- resolve provider, model, and thinking policy;
- verify required auth is available;
- report exact file and field diagnostics.

`check` never calls `discover()`, opens a browser, mutates credentials, starts a Session, or starts a daemon.

### `plot auth` and `plot models`

Keep the existing provider authentication flow and model catalog. Delete generic `plot config`.

Provider, model, and thinking policy belong in each Workflow because different Workflows are intentionally independently configured. Global provider/model fallback and `.plot/settings.json` are removed. Temporary CLI agent overrides—including `--api-key`, prompt replacement, resource replacement, and tool filtering—are removed from Session start commands.

A Workflow therefore declares its effective agent policy. `plot check` reports a missing provider or model directly. Environment/provider auth mechanisms remain owned by the agent/session seam.

### `plot docs`

Keep bundled docs because they are useful to humans and coding agents. Keep `plot docs sdk` and `plot docs --paths`. Remove legacy topic aliases.

## Commands removed without replacement

Delete these command families and all aliases:

```txt
plot open ...
plot run ...
plot runs ...
plot events ...
plot api ...
plot serve ...
plot setup ...
plot doctor ...
plot config ...
plot init ...
```

Replacement mapping exists only for documentation and implementation planning; no executable aliases survive:

| Removed                 | New behavior                                                |
| ----------------------- | ----------------------------------------------------------- |
| `plot open WORKFLOW.md` | `plot WORKFLOW.md`                                          |
| `plot open --web`       | `plot web`                                                  |
| `plot doctor`           | `plot check`                                                |
| `plot setup`            | Source Operator Actions in dashboards                       |
| `plot config`           | Explicit Workflow agent configuration                       |
| `plot init`             | No replacement until Plot has a real Source-driven scaffold |
| `plot run`              | No replacement                                              |
| `plot runs`             | TUI/Web Console, or `start`/`stop` by Workflow              |
| `plot events`           | No replacement                                              |
| `plot api`              | No replacement                                              |
| `plot serve`            | Internal process startup only                               |

Unknown removed commands fail as unknown commands. Do not print migration warnings indefinitely.

## Public SDK

`plot-ai/sdk` remains Plot's sole public programming interface.

This refactor preserves the trusted Extension model:

- Extension `id`, `parseConfig`, and `create`;
- Source requirements and Operator Actions;
- `discover()` and reconciliation semantics;
- Work Item identity and version;
- registered tools;
- lifecycle hooks;
- Extension/Workflow-scoped credentials.

Tighten the Workflow contract so `extension` is required. If the TypeScript representation is used after validated parsing, make `WorkflowRuntimeConfig.extension` non-optional there rather than scattering non-null assertions.

No registry, Session Manager, Session protocol, RuntimeEvent, Web route, or process record type is exported from `plot-ai`.

## Internal architecture

### Replace the registry with a Session Manager

The current registry is a shallow public-facing collection of process records, IPC requests, protocol records, replay functions, and formatting helpers. Replace it with one internal module named for the domain concept it owns: the Session Manager.

The TUI, Web Gateway, and CLI consume this interface; they do not know about sockets, child arguments, protocol envelopes, or registry records.

Conceptual interface:

```txt
interface SessionManager {
	start(input: StartWorkflow): Promise<StartSessionResult>;
	find(workflow: WorkflowKey): Promise<SessionSummary | undefined>;
	stop(workflow: WorkflowKey): Promise<SessionSummary | undefined>;
	list(): Promise<readonly SessionSummary[]>;

	snapshot(sessionId: SessionId): Promise<SessionSnapshot>;
	events(sessionId: SessionId, after?: number): AsyncIterable<RuntimeEvent>;

	tick(sessionId: SessionId): Promise<void>;
	startSourceAction(
		sessionId: SessionId,
		input: SourceActionInput,
	): Promise<void>;
	cancelSourceAction(sessionId: SessionId, actionRunId: string): Promise<void>;
	observe(sessionId: SessionId, input: OperatorObservation): Promise<void>;
}
```

This is a design shape, not a demand for an interface file or generic adapter framework. Keep one concrete implementation unless a second adapter actually exists.

The module owns:

- canonical Workflow keys;
- the one-active-Session invariant;
- daemon discovery and startup;
- child ownership and bounded shutdown;
- Session IDs and history paths;
- persisted Session summaries;
- stale child reconciliation;
- request correlation and timeouts;
- durable replay followed by live continuation;
- typed control actions.

### Session summary

Replace `RunRecord` with domain language. A persisted summary contains only data needed to restore Fleet and locate history:

```txt
interface SessionSummary {
	readonly id: SessionId;
	readonly workflowKey: WorkflowKey;
	readonly workflowName: string;
	readonly workflowPath: string;
	readonly projectPath: string;
	readonly state: "starting" | "online" | "stopping" | "stopped" | "error";
	readonly createdAt: string;
	readonly updatedAt: string;
	readonly historyPath: string;
	readonly diagnostic?: string;
}
```

Do not persist a separate public process/run ID. PID may be private manager state while live, but it is not Session identity.

Only `starting`, `online`, and `stopping` reserve a Workflow key. `stopped` and `error` are historical.

### Worker seam

A Session worker still needs a private transport because the manager owns detached child processes. Keep the seam private and typed for Plot's own needs.

Delete the generic public JSONL Session protocol and its schema. The private worker transport needs only:

- worker welcome/metadata;
- start;
- shutdown;
- snapshot;
- event delivery;
- the control actions used by current UIs.

It does not need public protocol version marketing, `ping`, arbitrary method names, schema printing, a standalone stdio server command, or a generic CLI request client.

If JSONL remains the simplest child transport, keep it. JSONL is an implementation choice, not a public product. Preserve bounded input, output, queues, and request timeouts.

The hidden worker entrypoint may remain in `main.ts`, but it must not be registered as a public command, rendered in help, or documented. Rename it away from `api` terminology, for example `__internal-session-worker`.

### Event ownership

Runtime events remain the canonical Session History and projection input. Do not delete them merely because `plot events` is deleted.

Consolidate replay and continuation in one manager operation:

```txt
manager.events(sessionId, after);
```

It must:

1. subscribe to live events;
2. replay durable history after `after`;
3. deduplicate by sequence;
4. continue from live delivery without a gap;
5. clean up subscriptions on cancellation.

Delete public `ServerRecord` envelopes from dashboard code. TUI and Web projections consume `RuntimeEvent` directly. Request responses are control-plane implementation details and never enter the event stream.

### TUI

Change the TUI from "spawn one run and own its death" to "attach to one managed Session."

The TUI receives a Session Manager connection and Session summary, obtains a snapshot/history projection, follows events, and submits typed controls. Its cleanup only releases UI resources and subscriptions.

Delete:

- spawning from `runTui`;
- stopping in its `finally` block;
- the unused `oneshot` mode;
- comments and tests asserting live-only behavior;
- protocol request construction in the TUI.

### Web Gateway and Web Console

The Gateway uses the same Session Manager interface as the CLI and TUI. Rename Web data from `runs` to `sessions` throughout TypeScript, routes, stores, and UI labels.

Replace `/api/runs` with private `/api/sessions` routes. The exact route shape is not public and receives no compatibility alias. Keep only endpoints used by the current Web Console:

- list/start/stop Sessions;
- Session projection or history continuation;
- Agent Transcript retrieval;
- Source actions;
- Operator observations.

Remove redundant endpoints that expose both raw Session History and equivalent projection data unless the current Web Console demonstrably uses both.

### Readiness and setup

Source setup remains part of the Session runtime and dashboards. Delete the separate CLI setup orchestration and its duplicate interaction adapter.

A Session may start while a Source requirement is `action-required`; it remains visible as `Needs You` and does not discover until ready. TUI and Web invoke Source actions through typed manager controls. Browser/OAuth callbacks and progress continue through Session events.

Fatal pre-start errors are limited to cases where Plot cannot construct the Workflow/Extension/agent at all. Actionable Source readiness is Session state, not process startup failure.

### Paths and configuration

Remove public overrides for:

- registry directory;
- Session directory;
- Plot directory;
- agent directory;
- queue and event capacities;
- tick and timeout values already expressible in Workflow configuration;
- system prompt and resource mutation;
- tool mutation;
- raw API keys;
- caller-supplied Session IDs.

Keep deterministic path injection in unit-level constructors where tests need isolation. Do not expose every internal test seam as a production CLI flag.

Workflow-relative Extension paths already resolve from the Workflow file directory; preserve that behavior. Extension credentials remain namespaced by Extension identity and Workflow identity, allowing two Workflows using one Extension to hold different credentials.

## Required deletions

The implementation should begin with deletion, then add only what the smaller model requires.

### CLI

Delete:

- `packages/cli/src/commands/api.ts`
- `packages/cli/src/commands/events.ts`
- `packages/cli/src/commands/run.ts`
- `packages/cli/src/commands/runs.ts`
- `packages/cli/src/commands/serve.ts`
- `packages/cli/src/commands/serve-api.ts`
- `packages/cli/src/commands/registry.ts`
- `packages/cli/src/commands/setup.ts`
- `packages/cli/src/commands/config.ts`
- `packages/cli/src/commands/init.ts`
- `packages/cli/src/run-client.ts`
- `packages/cli/src/run-output.ts`
- `packages/cli/src/runtime.ts`
- `packages/cli/src/extension-interaction.ts`

Replace `doctor.ts` with the narrower `check.ts`. Replace `open.ts` with root/start/stop/web orchestration rather than preserving its flags.

Shrink `args.ts` and `options.ts` aggressively. A removed public flag must remove its parsing and plumbing, not merely disappear from help.

### One-shot runtime

Delete:

- `makeOneShotWorkflowSource()`;
- `workflow:default` and its completion fact;
- `SessionRuntime.runOnce()`;
- the `once` execution state;
- `runOncePromise` and completion waiters used only by one-shot execution;
- `runSessionOnce()` and its event rendering;
- all one-shot and extensionless Workflow tests.

Require Extension configuration during Workflow validation.

### Protocol and registry surface

Delete:

- `sessionProtocolSchema`;
- the public method list and arbitrary method decoder;
- public protocol CLI client helpers;
- `streamRunRecordsGapless()` and `runEventRecords()` duplication;
- `RunRequest`/`RunResponse` names and public exports;
- `RunRecord`, `RunRegistry`, and user-facing run formatting;
- registry directory flags and `plot serve registry`;
- `@plot/registry` exports that leak store, supervisor, IPC, records, or events to callers.

Retain or rewrite only the minimum private worker transport and Session Manager implementation required for detached Sessions and dashboards.

### Configuration

Delete:

- `.plot/settings.json` provider/model fallback;
- global `~/.plot/settings.json` provider/model fallback;
- settings parsing in `agent-session.ts`;
- settings tests and docs;
- generic config key/value CLI code.

Workflow agent configuration plus provider auth becomes the only model selection path.

### Documentation

Rewrite, rather than patch around old wording:

- `README.md`
- `docs/index.md`
- `docs/quickstart.md`
- `docs/guide.md`
- `docs/workflows.md`
- `docs/extensions.md`
- `docs/cli.md`
- `docs/tui.md`
- `docs/web.md`
- `packages/npm/plot-ai/README.md`

Remove all references to one-shot Workflows, runs, run IDs, registry IPC, public RuntimeEvent streams, Session JSONL protocol, `open --web`, setup/doctor/config/init, and public HTTP compatibility.

The new quickstart must demonstrate a minimal real Source-driven Workflow. Do not reintroduce synthetic one-shot work as the easy path.

## Implementation sequence

The refactor may temporarily break the branch between commits, but each submitted PR should finish a vertical slice and end with `bun run check` passing.

### Slice 1: enforce the product model

1. Require `extension` in Workflow validation.
2. Delete extensionless Workflow support and one-shot runtime execution.
3. Delete `plot run`, its output rendering, tests, and docs.
4. Update examples and test fixtures to use a Source.

Exit condition: there is exactly one Session execution mode: continuous Source reconciliation.

### Slice 2: introduce Workflow identity and Session Manager language

1. Add canonical Workflow key resolution.
2. Replace `RunRecord` with `SessionSummary` and collapse process ID into Session ID.
3. Enforce one active Session per Workflow atomically in the manager.
4. Rename registry-owned code, storage, diagnostics, and tests to Session language.
5. Migrate persisted development state by deletion; no old store reader is required.

Exit condition: runtime code outside the Agent Run domain does not use bare `run` to mean a Session or process.

### Slice 3: change dashboard ownership

1. Make root `plot [workflow]` start-or-get and attach.
2. Make TUI stop the safe confirmed default while retaining an explicit detach action.
3. Add `plot start` and `plot stop` by Workflow.
4. Move durable replay plus live continuation behind the Session Manager.
5. Remove protocol envelopes from TUI projection input.

Exit condition: an explicitly detached Session survives TUI exit and the next root invocation reconstructs and attaches to it.

### Slice 4: separate Fleet Web Console

1. Add `plot web`.
2. Remove `open --web` and public `serve api`.
3. Migrate Gateway/Web names and private routes from runs to Sessions.
4. Delete redundant Web endpoints.
5. Verify Web Console exit does not stop Sessions.

Exit condition: terminal and Web are two clients of the same Session Manager, with truthful lifecycle semantics.

### Slice 5: remove public machine surfaces

1. Delete `plot runs`, `plot events`, and `plot api`.
2. Delete public schema and protocol documentation.
3. Narrow the worker transport to messages Plot itself uses.
4. Hide daemon and worker startup completely.
5. Collapse duplicate event replay implementations.

Exit condition: no user command accepts a Session/run ID and no public command emits raw RuntimeEvent or protocol records.

### Slice 6: remove setup and generic configuration

1. Move all Source requirement resolution to TUI/Web actions.
2. Replace doctor with side-effect-free `check`.
3. Delete setup and its CLI interaction duplicate.
4. Delete generic config and settings fallbacks.
5. Require agent policy in each Workflow and improve diagnostics.
6. Delete init until a real scaffold is designed.

Exit condition: the root help contains only the intended command map.

### Slice 7: delete residue

1. Search for old commands and terms.
2. Remove unused exports, files, dependencies, and tests.
3. Remove generated/release references to deleted commands.
4. Regenerate shipped docs and release artifacts.
5. Run release smoke checks.

Exit condition: old architecture cannot be recovered merely by re-registering hidden commands; its implementation is gone.

## Behavior tests

Do not preserve tests for deleted interfaces. Add the smallest behavior tests proving the new contracts.

Required tests:

1. Equivalent Workflow path spellings resolve to one Workflow key.
2. Two concurrent starts for one Workflow produce one active Session.
3. Two Workflows using the same Extension can run concurrently with separate configuration.
4. Editing a running Workflow does not hot-reload its Session; restarting loads the new definition.
5. Explicit TUI detach leaves the Session online; confirmed TUI stop terminates it.
6. Reattaching reconstructs projection from history and follows live events without loss or duplication.
7. `plot start` is idempotent.
8. `plot stop` is idempotent and releases the Workflow key.
9. An errored worker releases the Workflow key and leaves inspectable history.
10. An extensionless Workflow fails `plot check` with an exact diagnostic.
11. An action-required Source starts visibly in `Needs You` without calling discovery.
12. TUI/Web Source actions can make it ready and trigger reconciliation.
13. `plot check` never calls discovery or performs setup actions.
14. Web Console process exit leaves Sessions online.
15. Root help contains no removed commands or implementation nouns.

Keep existing scheduler, Source reconciliation, Session History, Agent Transcript, and extension-contract tests that still prove current domain behavior.

## Mechanical acceptance checks

These searches must return no public/runtime residue, except historical release notes if deliberately retained:

```bash
rg 'plot (open|run|runs|events|api|serve|setup|doctor|config|init)' README.md docs packages
rg 'run registry|RunRegistry|RunRecord|run-id|run id' README.md docs packages
rg 'one-shot|workflow:default|runOnce' README.md docs packages
rg 'session protocol schema|public session protocol' README.md docs packages
```

Agent Run terminology is valid and must not be mechanically renamed. A match must be classified by the glossary before changing it.

## Size and quality gates

The currently identified obsolete implementation is roughly 3,800 source lines and 3,000 directly associated test lines before docs. The replacement Session Manager and CLI orchestration should be substantially smaller.

Required outcome:

- net deletion across source plus tests;
- no new compatibility package;
- no aliases for deleted commands;
- no second event replay implementation;
- no public generic protocol framework;
- no interface with only one adapter introduced for ceremony;
- no optional-field plumbing for deleted CLI flags;
- no increase in production dependencies.

Line count is evidence, not the only goal, but a refactor that is net-additive has failed the brief and requires explicit justification.

## Validation

For every code slice:

```bash
bun run check
```

For the final release/package change:

```bash
bun run release:local --version 0.0.0-test --skip-check
```

The final smoke test must prove:

```bash
plot check workflows/acme.md
plot start workflows/acme.md
plot workflows/acme.md       # attach, then explicitly detach with d
plot workflows/acme.md       # reconstruct and reattach
plot web                     # Session is visible
plot stop workflows/acme.md
```

It must also prove that a second Workflow using the same Extension can remain active concurrently.

## Definition of done

This refactor is done when a new user only needs to understand:

1. an Extension implements reusable integration behavior;
2. a Workflow configures that Extension and teaches agent judgment;
3. Plot keeps one active Session for that Workflow;
4. `plot` attaches with safe stop and explicit detach controls, `plot start` starts in the background, `plot stop` stops, and `plot web` shows the fleet.

Users do not need to understand run registries, protocol records, event sequence cursors, daemon commands, one-shot scheduler modes, process IDs, or raw Session IDs. Those concepts either disappear or remain local to the implementation that owns them.
