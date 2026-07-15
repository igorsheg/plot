# Engineering Spec: Lean Plot Core

Status: proposed on 2026-07-15.

## Summary

Before Plot gains another feature, its core must become substantially smaller and easier to reason about. The priority is not abstraction, extensibility, or preserving internal APIs. The priority is deleting code, deleting states, deleting indirection, and leaving one obvious control path per owner.

This refactor covers:

- `packages/agent`;
- `packages/session`;
- `packages/session-manager`;
- `packages/sdk`;
- directly supporting code in `packages/common` when ownership changes require it.

Web and TUI changes are limited to adapting to smaller core contracts. Their redesign is outside this spec.

The current four core packages contain 8,254 production source lines and 4,437 test lines:

| Package                 |    Source |     Tests |
| ----------------------- | --------: | --------: |
| `@plot/agent`           |     1,808 |     1,018 |
| `@plot/session`         |     3,727 |     2,364 |
| `@plot/session-manager` |     2,235 |     1,055 |
| `@plot/sdk`             |       484 |         0 |
| **Total**               | **8,254** | **4,437** |

Most complexity is concentrated in seven files:

| Owner                                   | Files                                                                                                                               | Lines |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----: |
| Agent scheduling and state              | `packages/agent/src/runtime.ts`, `packages/agent/src/state.ts`                                                                      | 1,453 |
| Extension adaptation and Session events | `packages/session/src/extension-source.ts`, `packages/session/src/runtime.ts`                                                       | 1,338 |
| Managed process lifecycle               | `packages/session-manager/src/manager.ts`, `packages/session-manager/src/ipc.ts`, `packages/session-manager/src/session-process.ts` | 1,994 |

The planning target is to delete at least 2,000 production lines from the four core packages while retaining the intended product behavior. The resulting core should contain no more than 6,250 production lines. This is a deletion target, not permission to compress readable code, remove useful public SDK documentation, or hide complexity in generated code.

Every implementation slice must be net-negative across production code and its directly associated tests. A net-additive slice requires an explicit written justification before it is merged.

## Code quality

Legibility, local reasoning, and ease of change are the top priorities. Do not emit verbose, defensive AI-slop code.

- Write direct code with one obvious control path.
- Name the owner of mutable state and resource lifetimes.
- Keep modules deep and interfaces narrow.
- Prefer concrete types over generic frameworks and option bags.
- Do not create `shared`, `common`, `utils`, manager-of-managers, command buses, or view-model corridors without concrete repeated pressure.
- Do not mirror state between layers. Derive cheap values where they are rendered or emitted.
- Do not add defensive branches for states made impossible by the types or owner.
- Do validate external input, persisted data, provider data, and process boundaries.
- Bound queues, output, retries, subprocesses, retained data, and shutdown waits.
- Comments explain invariants, trade-offs, and provenance. They do not narrate syntax or restate types.
- Avoid boilerplate JSDoc on self-explanatory symbols. Public SDK documentation that explains behavior remains valuable.
- Port or expose one Pi capability at a time with its behavior tests and upstream provenance.
- Prefer deletion and a small concrete seam over a reusable framework.
- Do not preserve an internal API only because a unit test names it.

Line count is evidence. Moving code between packages, splitting one function into many wrappers, generating equivalent code, or replacing direct code with a generic framework does not satisfy the brief.

## State and transition design

Explicit-state, data-oriented design is mandatory for stateful behavior.

- Name the state owner, concrete states, and allowed transitions before distributing behavior across methods.
- Represent mutually exclusive states as direct discriminated unions with domain-named fields.
- Make invalid combinations unrepresentable instead of coordinating flags and optional properties.
- Do not hide domain states behind tagged-union builders, payload envelopes, class hierarchies, or a state-machine framework.
- Keep transition rules with the state owner.
- Separate transition decisions from side effects: admit from the current state, record the transition, run the bounded effect, then apply success, failure, cancellation, or stale completion.
- Handle closed unions exhaustively and use `never` checks.
- Validate open and external events before they enter an owner.
- Test transitions and forbidden transitions as behavior, including races, cancellation, stale completion, and bounds.
- A boolean is acceptable only for a truly independent binary fact.
- Keep one source of truth. Derived status, current run identity, and presentation are not additional mutable state.

No new state-machine, actor, reducer, event-bus, RPC, dependency-injection, or schema framework may be introduced by this refactor.

## Goals

1. One obvious `tick -> reconcile -> act` path owns Agent scheduling.
2. One record owns each active Agent Run and all resources tied to it.
3. One Extension Source owner owns discovery, requirement, retry, and Source-action state.
4. Session owns RuntimeEvent sequencing, durability, and live publication directly.
5. Session Manager owns Workflow lifecycle transitions through an explicit state union.
6. SessionProcess owns child readiness, command admission, exit, and escalation through an explicit state union.
7. Core types make invalid work, completion, requirement, and action states unrepresentable.
8. Private worker and manager boundaries validate their input once in the module that owns the contract.
9. Every queue and retained collection has a named bound and an explicit overflow outcome.
10. Dead capabilities, generic seams, compatibility input shapes, and test-only production APIs are deleted.
11. `@plot/agent` remains free of provider and Pi SDK details.
12. `@plot/session` remains the sole owner of the Pi SDK seam.
13. No new production dependency is added.

## Non-goals

- No new Plot feature.
- No Web or TUI redesign.
- No multi-Source scheduling feature.
- No Session recovery after worker or manager loss.
- No public worker, manager, event, or projection protocol.
- No compatibility adapter for deleted private APIs or Workflow shapes.
- No generalized scheduler, workflow engine, state machine, command bus, or RPC layer.
- No provider SDK types in `@plot/agent` or the public Extension contract.
- No arbitrary maximum file-size rule. A cohesive deep module is preferable to pass-through wrappers.

## Current structural problems

### Active Agent Runs have several owners

An active run is currently represented by all of the following:

- `RuntimeState.running`;
- `WorkRecord.status` and `currentRunId`;
- `runHandles`;
- `lastActivityAt`;
- `stallTimers`;
- generic duration timers.

Lifecycle is separately coordinated through `lifecycle`, `runPromise`, `stopPromise`, `resolveStopped`, `currentTickController`, `activeTickToken`, and `tickChain`.

The implementation therefore contains repair functions that synchronize representations rather than implement domain transitions. Casts such as `as unknown as WorkRecord` are a symptom of the type model permitting states the owner must later repair.

### Extension Source state is mirrored into generic Agent state

`extension-source.ts` stores discovered work in Agent `facts`, copies it into `selectedWork`, tracks running hook data in `activeRuns`, stores retry counts in another untyped fact, and reconstructs running and draining status from Agent snapshots.

Source-action admission is duplicated between SessionRuntime and the Extension Source bundle.

### Session reconsumes Agent events

Agent publishes events to an EventHub. SessionRuntime starts a background subscriber, republishes those events durably, and makes `tickOnce()` wait on tick-specific deferreds until the background subscriber establishes a sequence fence.

Session is the only production consumer of Agent events. The second hub, event pump, waiter map, and failure bridge exist only because event ownership is indirect.

### Managed process state is encoded in optional fields

Workflow lifecycle slots coordinate `tail`, `pendingStart`, and `pendingStop`. Live Sessions combine mutable summary state with optional cleanup and closing promises. SessionProcess separately coordinates readiness, failure, exit, and shutdown through booleans and optional promises.

These representations permit combinations that the code must rule out procedurally.

### Private boundaries are verbose but under-validated

Worker and manager transports repeat request unions, switches, wrappers, and error reconstruction. Despite that volume, nested command inputs and RuntimeEvents are frequently accepted through generic object casts or `as unknown as RuntimeEvent`.

Validation belongs once at the boundary owner. Internal values should remain trusted after admission.

### Event continuation is not bounded or gap-safe under pressure

Session continuation pumps live events into an unbounded queue with `{ force: true }`. Upstream EventHub subscribers use drop-oldest overflow. A slow history replay can therefore either retain unbounded live data or silently lose events without detecting a sequence gap.

### Session summaries are rewritten for high-frequency data

Every worker RuntimeEvent updates `lastSequence`, and every diagnostic chunk updates the summary. The file store rewrites the complete Session list for each update. Current clients continue from projection or history frontiers rather than the summary sequence, so this write amplification has no active consumer.

## Target ownership

## 1. `@plot/agent`

### Owner

One Plot Agent instance owns:

- Agent lifecycle;
- the current tick resource;
- one current Source;
- reconciled Source facts needed by dispatch;
- pending operator observations;
- pending run completions;
- active Agent Runs;
- scheduled wakes;
- bounded diagnostics;
- periodic tick scheduling.

The current Workflow creates exactly one Extension Source. The scheduler must implement that concrete product shape. Multiple Sources are a future feature and must not keep global/per-Source scheduling layers alive today.

Source identity remains part of Work and RuntimeEvent records. Removing the unused multiplexer does not remove the Source domain concept.

### Lifecycle

The owner uses a direct union equivalent to:

```txt
type AgentLifecycle =
	| { readonly state: "new" }
	| {
			readonly state: "running";
			readonly loop: Promise<void>;
			readonly tick?: ActiveTick;
	  }
	| { readonly state: "stopping"; readonly done: Promise<void> }
	| { readonly state: "stopped" };
```

The exact fields may differ, but the following combinations must be impossible:

- stopped with a current tick;
- new with a run loop;
- stopping without a completion promise;
- more than one current tick;
- a start after stopping has begun.

### Active Run

One record owns every run resource:

```txt
interface ActiveRun {
	readonly run: WorkRun;
	readonly work: WorkItem;
	readonly controller: AbortController;
	state: "running" | "draining";
	lastActivityAt: number;
}
```

Duration and stall timers, if implemented as separate timers, are fields of this owner. They are not stored in parallel maps.

`WorkRecord` does not mirror active-run identity. Runtime presentation derives running and draining status from the active-run record when emitting a snapshot or RuntimeEvent.

The selected WorkItem remains attached to the ActiveRun so Source transition hooks receive the exact selected work without an `activeRuns` mirror in `@plot/session`.

### Tick path

The implementation has one visible control path:

1. drain bounded pending observations and completions;
2. apply timeout, interruption, cancellation, and shutdown transitions;
3. observe the Source through a bounded, abortable effect;
4. reconcile the observation and newly completed runs;
5. commit reconciled Source facts and Work Items;
6. derive interruption and draining decisions;
7. select dispatch candidates;
8. admit eligible runs against the current state and concurrency bound;
9. record each ActiveRun before starting its effect;
10. launch runner effects;
11. publish the completed tick transition.

Reconciliation always completes before dispatch.

A run effect never mutates reconciled state directly. It reports activity, records exactly one completion, and requests a tick. Completion admission is idempotent by run identity, so a timeout followed by a stale runner completion cannot complete the run twice.

### Serialization

Remove the combination of actor mailbox and tick promise chain. Use one mechanism.

The preferred concrete shape is:

- bounded arrays for externally admitted observations;
- a bounded completion queue whose maximum follows active-run capacity;
- a coalesced `requestTick()`;
- one in-flight tick promise;
- one periodic wake timer.

JavaScript callback execution may append to owner-held pending arrays directly. Immutable whole-state copying is not required inside the owner. Snapshots copy data only when crossing an API or event boundary.

### Source contract

WorkSource methods used by production are required rather than optional. A no-op behavior is written explicitly by the one implementation rather than inferred through fallback branches in Agent.

Remove the generic Agent policy validator and the global/per-Source policy split. One concrete concurrency bound applies to the current Source.

Do not preserve an untyped `facts: Map<string, unknown>` merely to implement Extension discovery and retry state. Extension-specific state belongs to the Extension Source owner.

### Events

Agent receives one Session-provided event sink. It does not own a second EventHub. Event reporting is ordered with Agent transitions, and Session establishes the durability fence before a public Session operation resolves.

### Expected module shape

Prefer:

```txt
packages/agent/src/agent.ts
packages/agent/src/model.ts
packages/agent/src/work-source.ts
packages/agent/src/work-runner.ts
```

Delete `runtime.ts` and `state.ts` if their remaining behavior is clearer in the owning `agent.ts`. Retain a separate transition module only if it contains substantial pure transition logic rather than state synchronization helpers.

## 2. Core domain records

### Completion

Replace status plus optional payloads with a direct union:

```txt
type Completion =
	| (CompletionIdentity & {
			readonly status: "succeeded";
			readonly output?: unknown;
	  })
	| (CompletionIdentity & {
			readonly status: "failed";
			readonly error: string;
	  })
	| (CompletionIdentity & {
			readonly status: "interrupted";
			readonly reason: string;
	  })
	| (CompletionIdentity & {
			readonly status: "timed_out";
			readonly reason: string;
	  });
```

No constructor accepts a partial completion payload and casts it into the union.

### Work

Source-owned scheduling state and Agent-owned execution state are separate.

Source truth describes whether work is pending, waiting, blocked, cancelled, or absent. Agent execution describes whether a selected item has an active running or draining attempt. Do not store both in one mutable record and coordinate them through `currentRunId`.

Blocked state requires the fields needed to explain or act on it. Running state always has an ActiveRun. Completed work is an event/history fact rather than another live WorkRecord status.

### Source requirements

A requirement record is a union matching the public SDK state:

```txt
type SourceRequirementRecord =
	| RequirementIdentity & { readonly status: "checking" | "ready" }
	| RequirementIdentity & {
			readonly status: "action-required";
			readonly message: string;
			readonly actions: readonly OperatorAction[];
	  }
	| RequirementIdentity & {
			readonly status: "unavailable";
			readonly message: string;
			readonly retryAfterMs?: number;
	  };
```

Source readiness and message are derived from requirements when cheap. Do not store a second mutable readiness value that can disagree with them.

### Source action admission

Use:

```txt
type SourceActionStartResult =
	| { readonly accepted: false }
	| { readonly accepted: true; readonly actionRunId: string };
```

An accepted action without an id is impossible.

## 3. `@plot/session` Extension Source

### Owner

One Extension Source instance owns:

- loaded Extension runtime and tools;
- checked requirement state;
- forced action-required state caused by discovery or tools;
- latest discovered work by key;
- retry count and due wake by work key;
- at most one active requirement action per requirement;
- Source-action controllers and promises;
- Extension shutdown.

Agent owns active runs. SessionRuntime owns Session lifecycle and RuntimeEvents. The Extension Source must not mirror either.

### Discovery and reconciliation

The Source observes Extension data once per tick, validates it at the Extension boundary, and reconciles it against its owned previous discovery.

The reconciliation result directly describes:

- Source requirement state;
- current Source-owned Work Items;
- dispatch candidates;
- cancelled work keys;
- retry wakes;
- operator-hook effects;
- completion-hook effects.

Do not encode discovery or retry state into Agent generic facts. Do not rescan Agent running maps for every discovered item. Build concrete keyed collections once per reconciliation.

When work disappears or is superseded, Agent changes its ActiveRun to draining. When Extension discovery returns `cancelled`, Agent interrupts the matching ActiveRun. The Source does not publish a second running/draining copy.

### Run lifecycle hooks

Agent retains the selected WorkItem and reports run transitions back to its Source. Extension Source can therefore invoke Extension lifecycle hooks with the original `PlotExtensionWork` without `selectedWork` and `activeRuns` mirrors or non-null assertions.

### Requirement actions

Extension Source is the sole owner of requirement-action admission, cancellation, callback resources, and completion. SessionRuntime delegates controls and records Source-action events through callbacks.

Session shutdown asks Extension Source to cancel actions and waits for their bounded completion before closing Session event resources.

### Module shape

Simplify behavior before splitting the file. A cohesive `extension-source.ts` of roughly 400–500 lines is acceptable. Create another module only for a distinct resource owner such as credentials or OAuth callback mechanics.

## 4. `@plot/sdk`

The SDK is a public authoring contract. Useful behavioral documentation remains, but the executable and type surface becomes smaller and more exact.

### Delete no-op and mutable setup helpers

Delete the `work: (work) => work` identity callback. Authors can return a typed Work Item directly.

Replace `registerTool()` mutation during `create()` with tools returned as part of the Extension runtime:

```txt
interface PlotExtensionRuntime {
	readonly requirements?: readonly ExtensionRequirement[];
	readonly tools?: readonly PlotExtensionTool[];
	// ...
}
```

Tool factories remain per-run and receive the selected Work Item.

### Collapse completion hooks

Replace `completed`, `failed`, `interrupted`, and `timedOut` with one exhaustive hook:

```txt
type ExtensionRunCompletion =
	| { readonly status: "succeeded"; readonly output?: unknown }
	| { readonly status: "failed"; readonly error: unknown }
	| { readonly status: "interrupted"; readonly reason?: string }
	| { readonly status: "timed_out"; readonly reason?: string };

interface PlotExtensionRuntime {
	started?(event: {
		readonly work: PlotExtensionWork;
		readonly runId: string;
	}): MaybePromise<void>;

	finished?(event: {
		readonly work: PlotExtensionWork;
		readonly runId: string;
		readonly completion: ExtensionRunCompletion;
	}): MaybePromise<void>;
}
```

`runId` is required for every run lifecycle hook.

### Required cancellation contexts

`discover` and `shutdown` receive required concrete contexts containing an `AbortSignal`. Remove optional context shapes that force implementations to defend against missing ownership.

### Persisted credentials

`ExtensionCredentials.get()` returns `unknown`. Extension config or credential-specific code validates and narrows persisted data. A generic `<T>` cast must not make unvalidated persisted JSON appear typed.

### Narrow option bags

Replace one-field option bags with direct arguments where doing so improves the call:

- OAuth callback timeout;
- OAuth callback wait signal;
- URL fallback text.

Do not introduce a generalized interaction options type.

### Pi boundary

The public SDK remains provider-independent. `@plot/session` maps public tool definitions to Pi tool definitions in one module. Casts at that seam must be localized and justified against the upstream SDK type.

SDK contract changes update the examples in the same slice. Because the repository is not preserving compatibility for this internal cleanup, no deprecated aliases or adapters are added.

## 5. `@plot/session` RuntimeEvent ownership

### Owner

One Session runtime event owner holds:

- Session id;
- next sequence;
- serialized durable append chain;
- bounded live subscribers;
- lifecycle state;
- close state.

Agent transitions and Pi AgentSession events report directly to this owner.

### Event path

For every event:

1. allocate the next sequence;
2. append the event to durable history when retained;
3. publish it to live subscribers;
4. resolve the operation durability fence.

Delete:

- the Agent EventHub;
- the Session `agentEvents` pump;
- `tickWaiters`;
- `publishedTick`;
- `agentEventFailure`;
- generic event reconsumption to establish a tick fence.

`tickOnce()` waits for the Session-owned append chain after Agent completes the tick. It does not wait for a background subscriber to observe Agent output.

### Session lifecycle

Use a direct lifecycle union for new, running, closing, and closed. Start and shutdown are idempotent only in the explicitly allowed states. Other operations reject from closing and closed without inspecting combinations of lifecycle strings and optional promises.

### Source actions

SessionRuntime does not own a second Source-action map. It delegates to Extension Source and provides event callbacks. The Session close transition first stops Agent, then cancels and joins Extension Source resources within a bound, then records shutdown, then closes history and live events.

Late action or Agent completions carry their operation identity. Stale completions are ignored after the owner leaves the matching state.

## 6. Workflow loading and Session host

### Workflow validation

Keep direct validation of YAML because it is an external boundary. Do not add a schema dependency.

Delete:

- nested legacy `runtime:` support;
- temporary optional config objects followed by casts;
- impossible optional access to required `agent` and `extension` config;
- Workflow `queueCapacity` and `eventCapacity` knobs.

Queue bounds are internal safety constants, not Workflow behavior. Workflow retains behavioral policy such as tick interval, run duration, stall timeout, maximum turns, and concurrency.

### Preparation ownership

Delete the `takeExtensionBundle()` transfer protocol and its `closed`/`transferred` boolean coordination.

Use separate high-level operations:

- Workflow inspection loads, checks requirements, shuts the Extension down, and returns pure readiness data;
- Session host creation loads the Workflow and returns a host that owns the loaded Extension until host shutdown.

A small amount of duplicated orchestration is preferable to a transferable resource wrapper with invalid intermediate states. Shared parsing and loading functions remain narrow and stateless.

### Host wiring

Remove circular initialization in which Pi runner event callbacks close over a SessionRuntime variable assigned later. Create the Session event owner first and pass its concrete sinks to Agent and Pi runner construction.

Host shutdown owns one ordered sequence and one failure policy. It does not coordinate two optional resources through catch branches.

## 7. Private Session worker

### Commands

Retain only commands used by current products:

- `start`;
- `shutdown`;
- `tick`;
- `observe`;
- `source-action`;
- `source-action-cancel`.

Delete:

- `state`;
- `pause`;
- `resume`;
- controller-driven `interrupt`.

Source-proposed `interruptWork` and Source-action cancellation remain.

Worker `ready` already carries host metadata and history path. It does not call an asynchronous generic runtime `state()` operation to reconstruct data the host owns directly.

### Command types

Use a discriminated union whose payload is tied to its action. Commands with no input cannot carry input. Commands with input validate every required field before dispatch.

Delete generic `objectInput<A>()` casts. RuntimeEvent envelopes are parsed by one Session-owned decoder before they cross worker or manager boundaries.

### Writes and shutdown

Protocol writes remain bounded and serialized because events and command results may be produced concurrently. The worker owns one write chain and one failure. Protocol EOF triggers bounded host shutdown.

Do not build a generic protocol server abstraction.

## 8. `@plot/session-manager`

### Client capability versus daemon owner

The interface consumed by CLI, TUI, and Gateway contains only client operations:

- start, find, get, stop, stopSession, list;
- events;
- tick;
- Source actions;
- Operator observations.

Concrete daemon ownership methods such as recovery, force-close, and shutdown stay on the concrete SessionManager. The IPC client does not implement a fake no-op `shutdown()`.

There are two real implementations of the client capability—direct and IPC—so this narrow interface is earned.

### Workflow lifecycle owner

One lifecycle slot per canonical Workflow key uses a direct state union equivalent to:

```txt
type WorkflowSlot =
	| { readonly state: "idle"; readonly aliases: Set<string> }
	| {
			readonly state: "starting";
			readonly aliases: Set<string>;
			readonly operation: Promise<StartSessionResult>;
	  }
	| {
			readonly state: "online";
			readonly aliases: Set<string>;
			readonly session: LiveSession;
	  }
	| {
			readonly state: "stopping";
			readonly aliases: Set<string>;
			readonly session: LiveSession;
			readonly operation: Promise<SessionSummary>;
	  };
```

The exact queued-operation representation may differ, but it must encode these transitions explicitly:

| Current             | Operation | Transition/result                                     |
| ------------------- | --------- | ----------------------------------------------------- |
| idle                | start     | starting                                              |
| starting            | start     | join current start; caller reports `started: false`   |
| starting            | stop      | queue stop after the start reaches success or failure |
| online              | start     | return current Session                                |
| online              | stop      | stopping                                              |
| stopping            | stop      | join current stop                                     |
| stopping            | start     | queue fresh start after stop                          |
| starting failure    | —         | idle                                                  |
| stopping completion | —         | idle                                                  |

Every transition is implemented in the slot owner. Alias mapping does not create a second lifecycle slot.

### Live Session

Live process state is not mirrored through a mutable persisted summary. Keep stable Session identity/metadata plus an explicit live state. Derive a SessionSummary when returning or persisting it.

A process exit owned by explicit stopping results in `stopped`. An unexpected exit from starting or online results in `error` and releases the Workflow slot.

### Summary persistence

Remove `lastSequence` from SessionSummary and stop writing Session storage for each RuntimeEvent.

Keep diagnostic tails in live memory. Persist diagnostics when entering a terminal state or when another meaningful summary transition requires a write. Do not rewrite the complete store for every stdout/stderr chunk.

The file store uses atomic temporary-write plus rename. Remove speculative recovery of trailing NUL bytes and hand-reconstruction of truncated pretty JSON. An atomic store is either a valid old value or valid new value; malformed persisted input fails validation explicitly.

### SessionProcess

SessionProcess owns a direct state union for:

- waiting for ready;
- online;
- shutting down;
- exited.

Pending commands belong to the online or shutting-down owner. Child exit transitions once, rejects every pending command once, closes diagnostics once, and notifies the manager once.

Replace `failed`, `didExit`, optional `exit`, optional `shutdownPromise`, optional `readyRecord`, and deferred fields with the union. Expected exit during shutdown is represented as a shutdown transition rather than an error that the manager later ignores based on another state.

The existing dedicated fd 3 protocol channel, bounded diagnostic capture, command timeout, and graceful/TERM/KILL escalation remain.

### IPC

Identity is verified on the same connection as the requested operation. Do not open a separate `hello` connection before every command.

One socket carries one request. The request includes protocol/build identity and a concrete command. The server validates identity and command, executes it, writes one result or error, and closes. Event requests validate identity and then stream events until cancellation.

Delete the unused `events-ready` response. A successful event request begins with the first event; a rejected request begins with a structured error.

Request and response decoding remain direct switches. Do not replace them with method-name registries, generic payload maps, or RPC code generation.

Known boundary errors are reconstructed once through owner-provided decoding. Unknown errors remain bounded `PlotBoundaryError` records.

## 9. Gapless bounded event continuation

SessionManager event continuation must be both bounded and gap-safe.

Required sequence:

1. subscribe to live delivery before reading history;
2. replay durable history after the requested frontier;
3. deduplicate by sequence;
4. consume buffered live events;
5. detect a missing sequence or live-buffer overflow;
6. catch up from durable history before continuing live;
7. close the live subscription on cancellation.

The live buffer has a fixed internal capacity. Overflow is observable; it never silently drops or bypasses the bound. A gap causes durable catch-up, not an unbounded queue and not best-effort continuation.

Tests must create enough events during replay to exceed the live buffer and prove no loss, duplication, or unbounded retention.

## 10. Supporting `@plot/common` cleanup

`@plot/common` is not a destination for code displaced by this refactor.

- Move observability into `@plot/agent`; it has one production owner.
- Delete `Mutable<T>` by constructing exact domain values.
- Replace broad `primitives.ts` imports with owner-local parsing or direct language constructs.
- Retain JSONL and boundary-error mechanics only while they have concrete consumers in both Session and Session Manager.
- Remove EventHub from Agent. Re-evaluate whether the remaining Session and Manager uses warrant one shared implementation after ownership is simplified.
- Remove AsyncQueue from Agent if coalesced ticking and bounded pending arrays replace the mailbox.

Do not rename `common` to `shared`, `core`, or `utils` without reducing its responsibility.

## Delete-first inventory

The first implementation slice deletes the following vertical capabilities and residue:

### Agent

- exported `PlotAgent` symbol;
- public `run()` method;
- `AgentPolicy.validate`;
- global/per-Source policy split;
- runner `emitObservation` when no production runner uses it;
- direct controller `interruptAgentRun` operation;
- pause and resume dispatch operations;
- scheduler snapshot operation exposed through Session;
- test-only runtime configuration seams that become fixed owner constants.

### Session

- `packages/session/src/readiness.ts`;
- `loadDiscoveredWorkflow()`;
- `makePlotExtensionSourceBundleFromWorkflow()`;
- runtime `state()` and `schedulerSnapshot()`;
- worker `state`, `pause`, `resume`, and direct `interrupt` commands;
- `SessionRuntimeState` fields that duplicate host metadata;
- `lastEventSequence()` public operation;
- Workflow `queueCapacity` and `eventCapacity`;
- nested legacy `runtime:` Workflow input;
- export-list snapshot tests that preserve dead private modules.

### Session Manager

- pause, resume, and direct interrupt client operations and transport records;
- `lastSequence` persistence and event-driven summary writes;
- diagnostic-chunk persistence;
- separate hello request and connection;
- `events-ready` response;
- transported client no-op shutdown;
- truncated atomic-store salvage logic.

### SDK

- no-op Work Item identity callback;
- mutable tool registration callback;
- four separate completion hooks;
- optional run id on run lifecycle events;
- unchecked generic credential reads;
- compatibility aliases introduced only to preserve the old shape.

Deleting direct Agent interruption does not delete Source `interruptWork`, cancellation of a Source action, timeout interruption, stall interruption, or shutdown interruption.

## Bounds

Bounds are fixed close to their owner unless they are genuine Workflow behavior.

The refactor must preserve or add explicit bounds for:

- externally admitted Agent observations;
- active Agent Runs;
- pending run completions;
- scheduled wakes;
- Pi AgentSession event buffering;
- Session live subscribers;
- manager replay/live continuation buffering;
- diagnostic bytes;
- JSONL line bytes;
- retained diagnostics, completions, timeline entries, and token samples;
- Source retry delay and attempt metadata;
- discovered Work Item count;
- OAuth callback wait;
- Agent Run duration and inactivity;
- worker commands;
- graceful shutdown, TERM wait, KILL wait, and daemon-wide shutdown;
- Source-action cancellation and shutdown join.

Overflow behavior is one of:

- reject external admission;
- fail the owning operation;
- compact explicitly documented retained history;
- detect a sequence gap and recover from durable history.

`force: true`, silent drop-oldest for authoritative events, and unbounded defaults are forbidden in load-bearing paths.

Do not add user-facing capacity options. Choose one owner-local constant, explain the trade-off when non-obvious, and test the boundary behavior.

## Tests

Tests prove product contracts and owner transitions, not implementation scaffolding.

### Keep and strengthen

- tick observes, reconciles, then dispatches;
- a run starts without making the tick await its completion;
- completion is admitted exactly once;
- stale completion after timeout or cancellation is ignored;
- disappearance drains; explicit cancellation interrupts;
- Source readiness gates discovery without erasing last-known work;
- Source action success, failure, cancellation, and shutdown races;
- retry delay and reset semantics;
- run duration and stall interruption;
- bounded queue and overflow behavior;
- Session event durability before publication;
- Session shutdown ordering;
- Workflow start/start, start/stop, stop/start, and stop/stop races;
- controls rejected outside online state;
- process protocol isolation and shutdown escalation;
- direct and IPC Session Manager contract parity;
- bounded gapless history-to-live continuation;
- persisted-input and process-boundary validation;
- SDK examples typecheck and run through the real loader seam.

### Delete or replace

- tests for removed pause/resume/direct-interrupt operations;
- tests for generic Agent policy validation with no product caller;
- tests for multiple Source concurrency before multiple Sources are a feature;
- runner-emitted observation tests when the production runner has no such capability;
- export-list snapshot tests;
- tests that exist only to preserve nested legacy Workflow input;
- tests of atomic-store truncation recovery that the write protocol makes impossible;
- pure helper tests whose behavior is covered by an owner-level transition test.

### Transition tests

For every state union, include forbidden transitions and stale asynchronous completion:

- Agent start after stopping;
- second completion for one run;
- Source-action completion after cancellation;
- worker result after process exit;
- worker exit during explicit stop versus unexpected exit;
- start arriving during stop;
- stop arriving during start;
- event-buffer overflow during history replay.

Do not expose writable state or pure transition helpers solely to make tests convenient. Drive behavior through the owner's narrow operations.

## Implementation sequence

Each phase ends with `bun run check`. SDK or release-shape phases also run:

```bash
bun run release:local --version 0.0.0-test --skip-check
```

### Phase 1: delete unowned capabilities

- Remove the delete-first inventory across all four packages in one vertical slice.
- Update callers and remove associated tests rather than retaining adapters.
- Remove capacity fields from Workflow docs and examples.

Exit condition: no production transport or interface mentions state, pause, resume, or direct Agent interruption; no dead Session owner module remains exported.

### Phase 2: make domain states exact

- Convert Completion, Work, requirement, Source-action result, Agent lifecycle, and process lifecycle to direct unions.
- Update consumers exhaustively.
- Delete casts and defensive branches made unnecessary by the new types in the same slice.

Exit condition: active work cannot exist without one ActiveRun owner, accepted actions always have ids, and completion payloads match status without casts.

### Phase 3: rewrite Plot Agent

- Replace mailbox plus tick-chain serialization with one mechanism.
- Establish one ActiveRun map and one tick path.
- Remove mirrored work/run state and generic Agent policy/facts scaffolding.
- Send transitions directly to the Session event sink.
- Merge or delete `runtime.ts` and `state.ts` as earned by the final owner boundary.

Exit condition: a reader can follow one function from tick request through observe, reconcile, admission, and runner launch without jumping between synchronization helpers.

### Phase 4: narrow SDK and Extension Source

- Return tools from the Extension runtime.
- Collapse completion hooks.
- Make run ids and cancellation contexts required.
- Move requirement-action ownership wholly into Extension Source.
- Replace fact and run mirrors with concrete owned maps.
- Update examples and SDK documentation in the same slice.

Exit condition: Extension Source state is represented once and `extension-source.ts` no longer reconstructs Agent-owned running state.

### Phase 5: simplify Session ownership

- Create Session event ownership before Agent and Pi runner construction.
- Delete the Agent event pump and tick waiters.
- Split pure Workflow inspection from owned Session host construction.
- Remove transferable preparation state.
- Make shutdown order explicit and bounded.
- Narrow the worker command union and validate it once.

Exit condition: RuntimeEvent sequence, persistence, and publication have one owner and one path.

### Phase 6: rewrite managed lifecycle

- Replace Workflow slot, LiveSession, and SessionProcess flag combinations with explicit unions.
- Remove high-frequency summary persistence.
- Put identity on the same IPC request.
- Split client capability from daemon ownership.
- Implement bounded gap-aware event continuation.

Exit condition: start, stop, failure, and process exit can each be traced through one exhaustive transition owner.

### Phase 7: delete residue

- Remove newly unused files, exports, tests, dependencies, and `@plot/common` helpers.
- Search for deleted operations and stale terminology.
- Recount source and test lines.
- Update internal architecture documentation to match the resulting code, not the pre-refactor plan.

Exit condition: the smaller architecture cannot be expanded back into the old one by re-exporting hidden functions or restoring test-only methods.

## Mechanical checks

These searches should return no production matches after their owning phase:

```bash
rg 'schedulerSnapshot|pauseDispatch|resumeDispatch|interruptAgentRun' \
  packages/agent packages/session packages/session-manager
rg '"state"|"pause"|"resume"|"interrupt"' packages/session/src/worker.ts
rg 'loadDiscoveredWorkflow|makePlotExtensionSourceBundleFromWorkflow' packages/session
rg 'queueCapacity|eventCapacity' examples docs/workflows.md packages/session/src/workflow.ts
rg 'pendingStart|pendingStop|didExit|readyRecord|resolveStopped' \
  packages/agent/src packages/session-manager/src
rg 'as unknown as WorkRecord|as Completion|as unknown as RuntimeEvent' \
  packages/agent/src packages/session/src packages/session-manager/src
rg 'force: true' packages/agent/src packages/session/src packages/session-manager/src
```

Line counts are measured with:

```bash
find packages/{agent,session,session-manager,sdk}/src \
  -type f -name '*.ts' -print0 | xargs -0 wc -l
find packages/{agent,session,session-manager,sdk}/test \
  -type f -name '*.ts' -print0 | xargs -0 wc -l
```

Moving lines into `.tsx`, generated files, examples, or another internal package does not count as deletion.

## Acceptance criteria

The refactor is complete when all of the following are true:

1. The four core packages contain no more than 6,250 production source lines.
2. Source plus directly associated tests are net-negative in every phase and across the complete refactor.
3. Agent scheduling has one owner, one active-run representation, and one tick path.
4. Reconciliation always precedes dispatch.
5. Session owns RuntimeEvent sequencing, durability, and publication directly.
6. Extension Source owns requirement, discovery, retry, and Source-action state exactly once.
7. Session Manager and SessionProcess use explicit lifecycle unions with exhaustive transitions.
8. No authoritative event path is unbounded or silently drop-oldest.
9. History-to-live continuation recovers from buffer overflow without loss or duplication.
10. No persisted summary write occurs per RuntimeEvent or diagnostic chunk.
11. Worker and manager inputs are validated at their owning boundaries without generic object casts.
12. The public SDK has one completion hook, returned tools, required run ids, required cancellation contexts, and no unchecked generic credential reads.
13. Removed internal APIs have no compatibility aliases or deprecated wrappers.
14. `@plot/agent` has no Pi or provider SDK dependency.
15. `@plot/session` remains the only Pi SDK seam.
16. No new state-machine, actor, RPC, schema, event-bus, DI, or utility framework exists.
17. No new production dependency exists.
18. `bun run check` passes.
19. `bun run release:local --version 0.0.0-test --skip-check` passes after SDK and release-facing changes.

## Legibility review

Before completion, perform one review that ignores tests and asks only whether the production flow is instantly understandable:

- Can a reader identify the owner of every mutable map, controller, timer, queue, and promise?
- Can a reader enumerate every lifecycle state from one union?
- Can a reader follow Agent tick execution top to bottom in one module?
- Can a reader follow Session startup from manager admission to worker ready without a generic dispatcher?
- Can a reader follow explicit stop through graceful shutdown and escalation without reconciling independent flags?
- Can a reader identify exactly where external YAML, Extension output, worker JSONL, manager IPC, persisted summaries, credentials, and provider events are validated?
- Can any status or current-run value disagree with another mutable representation?
- Does every retained abstraction have at least two concrete consumers or remove more complexity than it adds?
- Would deleting any interface or helper make the code easier to follow without duplicating a real invariant?

Any “no” answer blocks completion even if the line-count target has been met.
