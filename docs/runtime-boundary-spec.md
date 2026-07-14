# Engineering Spec: Runtime Boundary and Session Lifecycle Hardening

Status: implemented on 2026-07-13.

## Summary

Plot's public model is intentionally small: a Workflow has at most one Active Plot Session, Plot manages that Session durably, and operators attach through the TUI or Web Console. The internal process and lifecycle boundaries must make those promises exact even when authored Extension code logs unexpectedly, commands race with shutdown, workers hang, storage fails, or the Session Manager is reached through IPC.

This spec hardens seven internal contracts without adding public commands, compatibility layers, or a scheduling DSL:

1. isolate worker protocol traffic from authored output;
2. serialize lifecycle operations per Workflow;
3. close control admission while a Session is stopping;
4. make graceful and forced shutdown bounded;
5. preserve tagged errors across private boundaries;
6. run shared contract tests against direct and transported implementations;
7. package only intentional, non-sensitive release files.

The design is informed by lifecycle, activity-gate, scoped-output, structured-error, and storage-contract patterns in Flue at commit `dbc9b05c71fadc1e8d66457815f7bf637c4dd010`. Plot keeps its own domain model and does not adopt Flue's one-shot run model, deployment surface, or public HTTP runtime.

## Problem

### Worker protocol and authored output share stdout

The Session worker currently writes JSONL protocol records to stdout. The same process imports and runs trusted Extension code. A normal `console.log()` or direct stdout write during module import, Extension creation, requirements, discovery, hooks, or tools can therefore place a non-JSON line into the protocol stream. The Session Manager treats that line as a protocol failure even though the authored code may otherwise be correct.

`plot check` also loads Extension code in the CLI process. Incidental console output can contaminate the command's human or machine-readable stdout.

### Lifecycle operations are coordinated by separate maps

The Session Manager currently tracks pending starts and stops separately. The current cases are covered, but the state space becomes harder to reason about as aliases, retries, start-during-stop, controls-during-stop, and bounded process termination interact.

### Stopping does not close control admission

A stopping Session remains in the live-process map. Commands such as tick, resume, Source action, or Operator Observation can race with shutdown and reach a worker that is draining.

### Shutdown has no complete escalation contract

The manager requests worker shutdown and then sends `SIGTERM`, but graceful completion, child exit, escalation to `SIGKILL`, final state, and daemon-wide shutdown are not owned by one bounded operation.

### Boundary errors lose structure

Worker and Session Manager IPC flatten failures into strings. Callers cannot reliably distinguish invalid input, unavailable state, protocol corruption, command timeout, incompatible process identity, or internal failure without parsing prose.

### Implementations can drift from their interfaces

Direct manager behavior, IPC behavior, memory storage, and file storage are tested independently. There is no shared contract suite proving that each implementation preserves the same intentional semantics.

### Release copying is broader than the public payload

The release build recursively copies documentation and examples with a small denylist. An accidentally added internal plan, symlink, `.env`, private key, runtime state directory, or generated file can enter a package unless its exact name is excluded.

## Goals

- Authored stdout and stderr can never corrupt Session worker protocol framing.
- `plot check` keeps stdout deterministic when Extension code uses `console.*`.
- Exactly one ordered lifecycle operation mutates a Workflow's active-session claim at a time.
- Start/start and stop/stop coalesce; start/stop races have explicit outcomes.
- Once stopping begins, new mutable controls are rejected before worker dispatch.
- Every shutdown path has a finite deadline and an explicit force-close fallback.
- Private boundaries preserve stable error codes and structured context.
- Direct and transported implementations pass the same behavioral contracts.
- Release packages contain only explicitly approved public files.
- Runtime code remains plain TypeScript with async/await, promises, async iterables, and tagged boundary records.

## Non-goals

- No public worker or Session Manager protocol.
- No compatibility adapters for the current private JSONL shape.
- No new CLI commands or invocation-time runtime flags.
- No hot reload of an Active Plot Session.
- No automatic continuation of an Agent Run after process loss.
- No promise that an Active Plot Session survives a Session Manager restart.
- No sandboxing of trusted Extension code.
- No generalized workflow engine, grant graph, or lifecycle DSL.
- No public remote Session Manager.
- No documentation search feature in this change.

## Invariants

### Protocol invariants

1. Authored code cannot write bytes to the worker protocol channel through normal stdout or stderr APIs.
2. Only Plot-owned code writes protocol records.
3. Every protocol record is one bounded JSONL line.
4. A malformed protocol record is a fatal worker-boundary failure; authored diagnostics are not parsed as protocol.
5. Protocol writes remain serialized in event/result order.
6. Diagnostic capture is bounded by bytes.

### Workflow lifecycle invariants

1. A canonical Workflow key owns at most one Active Plot Session.
2. One ordered lifecycle slot owns start and stop transitions for that Workflow.
3. Concurrent starts produce one worker and one `started: true` result.
4. A stop arriving during start executes after startup reaches a terminal result; if start succeeds, that Session is stopped.
5. A start arriving during stop executes after stop completes and creates a new Session.
6. Concurrent stops share one shutdown operation.
7. A failed pre-ready start leaves no durable Session and releases the lifecycle slot.
8. Equivalent Workflow aliases address the same lifecycle slot and are retained after successful use.

### Admission invariants

1. `starting`, `stopping`, `stopped`, and `error` Sessions do not accept new mutable controls.
2. Read-only summary/history access remains available while stopping and after stop.
3. Stop remains idempotent in every state.
4. Shutdown-internal cancellation is not routed through public control admission.

### Shutdown invariants

1. Graceful shutdown is attempted exactly once.
2. Graceful shutdown, termination grace, and forced kill are each bounded.
3. Every pending worker command settles when the worker exits.
4. Explicit operator stop ends as `stopped`, including when force was required; forced termination is retained as a diagnostic.
5. Unexpected worker loss ends as `error`.
6. Event and diagnostic subscriptions close exactly once.
7. Session Manager shutdown cannot wait forever for one worker.

### Error invariants

1. Private boundaries transmit a stable code and structured context, not only prose.
2. Message text is diagnostic, not an API.
3. Unknown exceptions become a bounded `internal_error` record.
4. Secrets, credentials, full prompts, and arbitrary authored values are not copied into structured context.
5. The CLI remains the sole renderer of CLI errors.

### Release invariants

1. Public release payloads are allowlisted, not recursively copied and then patched with a growing denylist.
2. Symlinks are rejected.
3. Secret-shaped files and runtime state are rejected.
4. Internal plans, PRDs, and engineering specs do not ship.
5. Packaged-binary smoke tests inspect the actual tarball/install output.

## Design

## 1. Dedicated worker protocol channel

### Process descriptors

The Session Manager spawns a worker with four explicit channels:

```txt
fd 0  manager -> worker command JSONL
fd 1  authored/runtime stdout diagnostics
fd 2  authored/runtime stderr diagnostics
fd 3  worker -> manager record JSONL
```

`createSessionChildProcess` uses `stdio: ["pipe", "pipe", "pipe", "pipe"]`. `SessionChildProcess` exposes the fourth stream as `protocol`, separate from `stdout` and `stderr`.

The hidden worker entrypoint creates a writable stream for fd 3 and passes that stream to `serveSessionWorker.writeLine`. No protocol record is written through `process.stdout`.

The exact fd is private. Tests inject streams through the existing worker seam and do not depend on operating-system descriptors.

### Diagnostics

`SessionProcess` consumes both stdout and stderr as diagnostics. It retains one bounded tail with stream labels so debugging preserves provenance:

```txt
[stdout] Extension connected
[stderr] API retry 2/3
```

Diagnostics are operational data, not RuntimeEvents. They are not appended automatically to Session History because authored output may be noisy or sensitive. The existing bounded Session summary diagnostic may retain the tail.

Control characters that can corrupt terminal output are normalized before presentation. Byte limits are applied after UTF-8 encoding.

### `plot check` output

`plot check` still prepares the Workflow in the CLI process. During Extension import, creation, and requirement checks, Plot temporarily captures `console.log`, `console.info`, `console.debug`, `console.warn`, and `console.error` for that asynchronous preparation scope and sends formatted lines to the CLI diagnostic sink on stderr.

The capture must:

- use `AsyncLocalStorage` or an equivalent scoped mechanism;
- restore every console method in `finally`;
- pass calls outside the active preparation scope through unchanged;
- preserve stderr/stdout classification in the diagnostic sink;
- never convert authored logs into successful command output.

Direct `process.stdout.write()` during `plot check` remains unsupported trusted-code behavior. The SDK documentation should direct Extensions toward a future Plot logger capability or `console.*`, not direct process streams. Worker execution remains safe even for direct stdout writes because protocol uses fd 3.

### Failure semantics

- Protocol EOF before `ready`: transactional start failure; no Session summary.
- Protocol EOF after `ready`: unexpected worker loss; Session becomes `error` unless explicit stop owns shutdown.
- Malformed protocol record: `worker_protocol_error` and worker termination.
- Diagnostic stream failure: retained as a diagnostic if possible; does not reinterpret diagnostic bytes as protocol.

## 2. Per-Workflow lifecycle serialization

### Lifecycle slot

The Session Manager owns a keyed internal slot per canonical Workflow key. Aliases resolve to that same slot after canonicalization or a stored alias match.

Conceptual shape:

```txt
WorkflowLifecycleSlot {
  tail: Promise<void>
  pendingStart?: Promise<StartSessionResult>
  pendingStop?: Promise<SessionSummary | undefined>
}
```

The implementation may differ, but all mutating lifecycle transitions enter through one slot. The slot is a small keyed promise queue, not a general scheduler.

### Operation semantics

| Existing operation/state | Incoming operation | Result                                                              |
| ------------------------ | ------------------ | ------------------------------------------------------------------- |
| pending start            | start              | share pending start; only creator reports `started: true`           |
| pending start            | stop               | queue stop after start; failed start makes stop an idempotent no-op |
| online                   | start              | return existing Session with `started: false`; remember alias       |
| online                   | stop               | begin one shutdown                                                  |
| pending stop             | stop               | share pending stop                                                  |
| pending stop             | start              | queue a fresh start after stop completes                            |
| stopped/error            | stop               | informational no-op                                                 |
| stopped/error            | start              | create a new Session                                                |

The slot is removed when it has no pending operation and no active Session. Historical Session summaries do not retain lifecycle slots.

### Transaction boundary

Start remains transactional:

1. canonicalize the existing Workflow path;
2. enter the Workflow lifecycle slot;
3. reject or return an existing Active Plot Session;
4. spawn the worker;
5. wait for shared Workflow preparation and worker `ready`;
6. install the live process;
7. persist the Session summary;
8. command the Session online;
9. release the pending-start operation.

Failure before step 6 kills the child and creates no durable Session. Failure after installation records an errored Session.

## 3. Control admission while stopping

### State matrix

The Session Manager validates Session state before dispatching every control.

| Operation                  | starting | online | stopping | stopped/error |
| -------------------------- | -------: | -----: | -------: | ------------: |
| get/list/events            |      yes |    yes |      yes |           yes |
| stop                       |      yes |    yes |      yes |    idempotent |
| tick                       |       no |    yes |       no |            no |
| pause/resume               |       no |    yes |       no |            no |
| interrupt Agent Run        |       no |    yes |       no |            no |
| start/cancel Source action |       no |    yes |       no |            no |
| Operator Observation       |       no |    yes |       no |            no |

A rejected mutable control throws `SessionNotControllableError` with `sessionId`, requested operation, and current state.

### Ordering

The manager persists `stopping` before closing admission. The in-memory state update happens before the awaited store write so concurrent controls observe `stopping` immediately. If persistence fails, shutdown does not silently reopen admission; the process owner continues bounded cleanup and reports the storage failure.

The worker also rejects non-shutdown commands after its runtime begins closing. Manager admission is the primary guard; worker rejection is defense in depth.

## 4. Bounded shutdown and process ownership

### SessionProcess API

`SessionProcess` owns graceful and forced child termination. Conceptually:

```txt
shutdown({
  gracefulMs,
  terminateMs,
  killMs,
}): Promise<{
  mode: "graceful" | "terminated" | "killed"
}>
```

It is idempotent: concurrent calls share one shutdown promise.

### Escalation sequence

1. Send the worker `shutdown` command.
2. Wait up to `gracefulMs` for command completion and natural child exit.
3. If still alive, send `SIGTERM` and wait up to `terminateMs`.
4. If still alive, send `SIGKILL` and wait up to `killMs`.
5. Settle all pending commands with a tagged process-exit error.
6. Return the termination mode.

Suggested initial internal defaults:

```txt
gracefulMs  30_000
terminateMs  5_000
killMs       2_000
```

These are constructor seams for tests and internal tuning, not CLI flags.

### Session state result

An explicit operator stop records `stopped` after the child is gone. If escalation was required, the Session diagnostic records the termination mode and timeout without changing the operator-requested outcome to `error`.

An exit not owned by an explicit stop records `error` and releases the Workflow claim.

### Manager daemon shutdown

Daemon shutdown:

1. stops accepting new IPC connections;
2. closes Session control admission;
3. stops live Sessions in parallel through their bounded `SessionProcess.shutdown` operations;
4. closes the socket and store resources;
5. exits after a global bound even if cleanup code is defective.

The existing synchronous parent-exit child kill remains a last-resort safety net, not the normal lifecycle.

## 5. Tagged private boundary errors

### Record shape

Worker and manager boundaries use one private structural record:

```txt
BoundaryErrorRecord {
  code: string
  message: string
  retryable: boolean
  context?: Record<string, string | number | boolean | null>
}
```

The record is carried by worker command failures and Session Manager IPC error responses.

### Ownership

Concrete errors live with the module that owns the failed invariant. Plot does not create one cross-domain mega-file.

Initial vocabulary:

| Owner                | Code                        | Structured context               |
| -------------------- | --------------------------- | -------------------------------- |
| Workflow preparation | `workflow_invalid`          | phase, path                      |
| Session Manager      | `session_not_found`         | sessionId                        |
| Session Manager      | `session_not_controllable`  | sessionId, state, operation      |
| Session worker       | `worker_protocol_error`     | phase                            |
| SessionProcess       | `worker_command_timeout`    | action, timeoutMs                |
| SessionProcess       | `worker_exited`             | phase, signal/code when known    |
| Manager IPC          | `manager_identity_mismatch` | client identity, daemon identity |
| Generic boundary     | `internal_error`            | boundary only                    |

Existing owner-specific errors such as `WorkflowBoundaryError` and `SessionManagerIdentityError` should implement or map to this representation rather than being replaced by string-prefix conventions.

### Decoding

- The worker encodes owner errors to records.
- `SessionProcess` decodes records into typed local errors.
- Manager IPC preserves the record unchanged.
- The IPC client reconstructs the appropriate owner error where known and a generic `PlotBoundaryError` otherwise.
- CLI, TUI, and Web make decisions from code/context and render message text once.

Tests assert error class, code, and context. Tests do not pin full prose unless prose itself is the user-facing contract under test.

## 6. Shared contract suites

### Session Manager contract

Create one behavior suite parameterized by a factory:

```txt
create(): Promise<SessionManagerRuntime>
cleanup(): Promise<void>
```

Run it against:

- direct `SessionManager`;
- `createSessionManagerClient` connected to a real local IPC server.

The suite proves:

- equivalent Workflow paths produce one active Session;
- concurrent starts coalesce;
- stop during start stops the resulting Session;
- start during stop creates a fresh Session;
- concurrent stops coalesce;
- deleted aliases remain stoppable;
- controls are rejected while stopping;
- pre-ready failure leaves no Session;
- unexpected post-ready exit records error;
- history replay follows live events without gaps or duplicates;
- aborting event continuation releases transport resources;
- tagged errors survive transport.

### Session Store contract

Run one small suite against memory and file stores:

- empty list/get;
- insert and replacement by Session id;
- Workflow aliases round-trip;
- serialized concurrent upserts do not corrupt storage;
- restart recovery marks only Active Plot Sessions errored;
- terminal Sessions remain unchanged;
- malformed/truncated file behavior matches the documented recovery policy.

Do not add adapter abstractions beyond the existing interface until a third real implementation earns them.

### SessionProcess contract

Use a narrow fake child plus one real hidden-worker integration case to prove:

- stdout/stderr cannot become protocol records;
- malformed fd-3 JSON fails the process;
- command timeout settles exactly once;
- graceful exit avoids signals;
- hung shutdown escalates through TERM and KILL;
- concurrent shutdown calls coalesce;
- pending commands reject on exit;
- diagnostics remain byte-bounded.

## 7. Release payload hardening

### Public documentation manifest

Release packaging copies public documentation from the navigation manifest in `docs/docs.json`, plus only explicitly named package files. Internal documents are absent by construction; adding another PRD or spec does not require extending a denylist.

`plot docs` and the release manifest use the same public document inventory so shipped files and command topics cannot drift.

### Example manifest

Examples are copied from tracked files only. The release build rejects:

- symbolic links;
- `.plot`, `node_modules`, VCS metadata, and editor swap files;
- `.env`, `.env.*`, `.dev.vars`, `.dev.vars.*`;
- common private-key and certificate suffixes;
- sockets, devices, FIFOs, and any non-regular filesystem entry.

If release builds must work outside a Git checkout, generate and commit an explicit example-file manifest rather than falling back to recursive copying.

### Package smoke tests

The installed-package smoke suite asserts:

- internal documents are absent;
- no forbidden path or symlink exists in the tarball;
- public docs listed by the manifest are present;
- `plot --help`, `plot --version`, docs, and usage exit semantics still pass;
- a production-shaped worker whose Extension logs to stdout and stderr reaches `ready` and shuts down without protocol corruption.

## Ownership map

| Concern                                            | Owning module                                                                 |
| -------------------------------------------------- | ----------------------------------------------------------------------------- |
| Hidden process descriptor wiring                   | `packages/cli/src/main.ts` and `packages/cli/src/plot-command.ts`             |
| Worker record codec and command loop               | `packages/session/src/worker.ts`                                              |
| Child transport, diagnostics, timeout, escalation  | `packages/session-manager/src/session-process.ts`                             |
| Per-Workflow lifecycle serialization and admission | `packages/session-manager/src/manager.ts`                                     |
| Manager transport error preservation               | `packages/session-manager/src/ipc.ts`                                         |
| Shared Workflow preparation output capture         | `packages/session/src/preparation.ts` with CLI-provided diagnostic capability |
| Public release payload                             | `scripts/release/build.ts` and `scripts/release/smoke.ts`                     |

`@plot/session` remains unaware of provider SDK details beyond its existing seam. `@plot/agent` remains unaware of worker transport. TUI and Web consume Session Manager concepts and never inspect protocol envelopes.

## Security and privacy

- The dedicated protocol fd prevents accidental corruption; it is not a sandbox against malicious trusted code in the same process.
- Diagnostic tails are bounded and must not be treated as a safe place for credentials.
- Structured errors contain allowlisted scalar context only.
- Raw causes remain local to the process that owns them unless explicitly converted to safe context.
- Release scanning is a backstop; repository review remains responsible for authored public examples.

## Observability

The Session summary may expose:

- bounded diagnostic tail;
- last worker termination mode;
- last boundary error code;
- timestamps already owned by the summary.

Do not add protocol records or diagnostics to Session History merely for debugging. RuntimeEvents remain domain/control-plane facts; transport noise remains transport diagnostics.

## Rollout sequence

### Phase 1: protocol isolation

- Add fd-3 protocol stream to child and hidden worker entrypoint.
- Consume stdout and stderr only as diagnostics.
- Add Extension logging behavior tests.
- Add scoped `console.*` capture for `plot check`.

### Phase 2: ordered lifecycle and admission

- Replace separate start/stop coordination with per-Workflow lifecycle slots.
- Define start-during-stop behavior.
- Reject mutable controls outside `online`.
- Add direct manager race tests.

### Phase 3: bounded shutdown

- Move escalation into idempotent `SessionProcess.shutdown`.
- Make explicit stop wait for actual child exit.
- Bound daemon-wide shutdown.
- Add hung-worker tests.

### Phase 4: tagged errors

- Introduce the private boundary record and owner-specific mappings.
- Update worker and manager IPC together with no compatibility shim.
- Update CLI/TUI/Web decisions to use codes.

### Phase 5: contract suites

- Extract the intentional manager contract and run direct plus IPC.
- Add memory/file Session Store contract.
- Keep implementation-specific tests only for implementation-specific behavior.

### Phase 6: release allowlists

- Replace recursive docs/examples copying.
- Add tarball payload assertions.
- Keep the internal protocol and engineering documents out of published packages.

Each phase must leave `bun run check` green. Release-affecting phases also run:

```bash
bun run release:local --version 0.0.0-test --skip-check
```

## Acceptance criteria

The spec is complete when all of the following are proven by behavior tests:

```txt
Extension console output cannot corrupt worker IPC.
Worker protocol bytes travel only through the dedicated protocol channel.
One Workflow lifecycle slot orders every start and stop.
Start during stop creates a fresh Session after stop completes.
Mutable controls never dispatch to a stopping Session.
Explicit stop has a finite graceful/TERM/KILL bound.
The final stopped state is recorded only after child termination.
Boundary error codes and context survive worker and manager IPC.
Direct and IPC managers pass the same lifecycle contract.
Memory and file stores pass the same storage contract.
Release tarballs contain only allowlisted public docs and tracked safe examples.
No public CLI command or compatibility shim was added.
```

## Future work requiring a product decision

Resuming an Active Plot Session after Session Manager or worker loss is intentionally outside this spec. Before implementing it, Plot needs a product decision defining what “durable active execution” promises across process loss.

If that promise is adopted, recovery must be derived from durable Session History through a pure classifier. An uncertain, possibly side-effecting Agent Run must not be blindly replayed. Plot should reconcile Source facts first and decide whether work is done, continued, retried, or replaced.
