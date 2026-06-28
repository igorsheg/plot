# PRD: Plot Runs, Dashboard, and API

## Status

Draft for the CLI/product-surface refactor. Before implementing this PRD, land any unrelated pending work (for example the SDK tool-boundary refactor) in a separate commit.

## Problem

Plot's current CLI exposes implementation seams as product concepts:

- `plot tui`
- `plot run`
- `plot web`
- `plot serve stdio`
- `plot serve fleet`
- `plot instances ...`

This makes Plot feel like a bag of transports and process managers instead of one product. It also prevents the expected dogfooding flow:

1. Start several Plot TUIs in different terminals.
2. Open the web dashboard.
3. See those running TUI-backed Plot runs appear automatically.

Today `plot web` starts its own fleet server and only sees runs owned by that web process. A TUI run is in-process and invisible to the web dashboard.

## Product goal

Plot is both:

1. An end-user product for running and watching AI work.
2. A building block for custom clients and frontends.

The product nouns should be:

- **Run** — one Plot workflow runtime, live or stopped.
- **Dashboard** — a human UI over runs in a workspace.
- **API** — a machine transport over runs in a workspace.
- **Workflow** — the user-authored `WORKFLOW.md` plus optional extension.

Do not expose `fleet`, `instance`, `supervisor`, `stdio server`, or `protocol stream` as primary user-facing nouns.

## Reference: pi orchestrator

Use `.references/pi/packages/orchestrator` as an implementation reference, not a product-language reference.

Relevant pi files:

- `.references/pi/packages/orchestrator/src/types.ts`
  - Defines `InstanceRecord` with `id`, `status`, `cwd`, `label`, `sessionId`, `sessionFile`.
- `.references/pi/packages/orchestrator/src/supervisor.ts`
  - Owns live child processes in `liveInstances`.
  - Persists instance records through `storage.ts`.
  - `spawnInstance()` creates a record, starts an RPC process, syncs session metadata, marks online.
  - `recoverAfterRestart()` marks stale `online` / `starting` records stopped.
  - `openRpcStream()` lets clients attach to one live instance.
- `.references/pi/packages/orchestrator/src/ipc/server.ts`
  - Serves a Unix socket.
  - Handles list/spawn/status/stop.
  - Has a long-lived stream mode for one instance.
- `.references/pi/packages/orchestrator/src/cli.ts`
  - Exposes `serve`, `list`, `spawn`, `status`, `stop`, `rpc`, `rpc-stream`.

Pi's architecture is useful:

```txt
registry daemon
  owns live child processes
  persists records
  exposes socket API
clients attach to records
```

Pi's public nouns are not what Plot should copy. Plot should expose runs/dashboard/API instead.

## Current Plot code map

Important current files:

- `packages/session/src/host.ts`
  - Owns one in-process Plot session host.
  - Composes workflow, event log, runtime, pi runner, protocol adapter.
- `packages/session/src/fleet.ts`
  - Current process registry / child owner.
  - Public names still say `Fleet`, `FleetInstanceRecord`, `FleetRuntime`.
- `packages/session/src/fleet-ipc.ts`
  - Current Unix socket boundary for list/spawn/status/stop/stream.
- `packages/cli/src/runtime.ts`
  - `serveStdio()` starts one in-process protocol host over stdio.
  - `serveFleet()` starts the fleet socket daemon.
- `packages/tui/src/plot-tui.ts`
  - Currently starts an in-process `createProtocolSessionHost()` and renders directly over its protocol.
  - This is why TUI runs are invisible to web.
- `packages/cli/src/web-gateway.ts`
  - Currently starts its own `startFleetIpcServer()` and serves web assets + HTTP/SSE API.
  - This creates an isolated run universe per `plot web` process.
- `packages/cli/src/commands/instances.ts`
  - Debug surface for fleet internals.
- `packages/cli/src/commands/serve.ts`
  - Exposes implementation transports.

## Desired UX

### Default TUI

```sh
plot
plot --workflow examples/pr-review/WORKFLOW.md
```

Behavior:

1. Ensure the workspace run registry is available.
2. Start a managed run for the selected workflow, or attach to an existing matching live run when explicitly requested.
3. Open the terminal dashboard attached to that run.
4. The run is visible to `plot web`, `plot ls`, and API clients while it is live.

### Web dashboard

```sh
plot web
```

Behavior:

1. Ensure the same workspace run registry is available.
2. Start the browser dashboard.
3. Show all live and recent runs from the workspace registry, including runs that were started by `plot` TUI commands.
4. Let the user create/stop/tail/project runs through the same API used by custom clients.

### Headless one-shot

```sh
plot run --once
# or simply: plot run
```

Behavior:

- Runs one workflow to the current one-tick/one-shot semantics.
- Emits useful terminal output.
- May either register a short-lived run record or remain a pure local one-shot. Prefer registering if it improves observability without complicating shutdown.

### Run management

```sh
plot ls
plot status <run-id>
plot stop <run-id>
plot logs <run-id>
```

Behavior:

- Use `run`, not `instance`, in help, docs, JSON fields where feasible.
- `plot ls` should be the friendly replacement for `plot instances list`.

### Building-block API

```sh
plot api --stdio
plot api --http --port 0
```

Behavior:

- `plot api --http` serves the workspace API without necessarily opening the web UI. The web UI can be assets on top of the same server, but the API must be usable independently.
- `plot api --stdio` exposes the same workspace run API over JSONL stdio for custom frontend processes.
- The API owns run list/spawn/status/stop/stream/submit. A custom frontend should not need to understand internal `fleet` names.

## Architecture target

### Ownership

`@plot/session` owns runtime and transport boundaries:

- One-run host: workflow + event log + runtime + pi runner + session protocol.
- Run registry: live child ownership, persisted run records, restart recovery.
- Run IPC/API schemas: decoded and validated at the boundary.

`@plot/tui` owns terminal rendering only:

- It should be able to attach to a run protocol stream/client.
- It should not have to create a `SessionHost` itself for the default product path.
- A small in-process test/demo path is acceptable only if it does not become the product path.

`@plot/cli` owns command mapping and process startup:

- Product commands map to user jobs.
- CLI may start the registry daemon, web server, or attach TUI clients.
- CLI must not become runtime state owner.

`@plot/web` owns browser UI only:

- It consumes the workspace API.
- It does not own a separate run registry universe.

### Runtime shape

Target process topology:

```txt
workspace run registry (daemon or long-lived owner)
  ├─ run A child: plot api/run-host for WORKFLOW.md
  ├─ run B child: plot api/run-host for examples/pr-review/WORKFLOW.md
  └─ persisted run records + event log paths

plot TUI process
  └─ attaches to run A through registry protocol stream

plot web process
  └─ serves browser assets and HTTP API backed by the same registry

custom frontend
  └─ attaches through `plot api --stdio` or `plot api --http`
```

A TUI-started run is therefore a normal Plot run with a TUI frontend attached.

## Naming plan

Nuclear but controlled rename:

| Current internal/public term | Target product term                     |
| ---------------------------- | --------------------------------------- |
| fleet                        | run registry                            |
| instance                     | run                                     |
| supervisor                   | do not reintroduce                      |
| `serve fleet`                | internal registry daemon / hidden debug |
| `instances`                  | `ls`, `status`, `stop`, `logs`          |
| `serve stdio`                | `api --stdio`                           |
| protocol stream              | event stream / run stream               |

Implementation may keep a private `Fleet` class briefly during the refactor, but primary exported modules, CLI help, docs, and tests should converge on run terminology.

Do not add compatibility aliases unless the user explicitly asks for a compatibility release. This repo has already chosen clean breaking changes over shims.

## Proposed module shape

Prefer direct owners, no barrels.

### `packages/session/src/run-registry.ts`

Replacement for `fleet.ts`.

Owns:

- `RunRecord`
- `RunStatus`
- `RunRegistry`
- `RunStore`
- spawn/list/status/stop/attachRecords/submit
- stale recovery

It may initially be a rename/refactor of `Fleet`, but API names should be run-shaped.

### `packages/session/src/run-ipc.ts`

Replacement for `fleet-ipc.ts`.

Owns:

- Unix socket path resolution.
- JSONL request/response schemas.
- `startRunIpcServer()` / `sendRunIpcRequest()`.
- Stream attach semantics.

Boundary rules:

- Decode/validate all unknown JSON at this boundary.
- Do not cast requests or responses.
- Preserve stream client disconnect behavior.

### `packages/session/src/host.ts`

Still owns one run host.

May need an explicit child-run entrypoint mode so registry-spawned children are run hosts without TUI/web UI.

### `packages/tui/src/plot-tui.ts`

Refactor from in-process host owner to run client frontend:

- Accept a run protocol client/stream or a `runId` + registry client.
- Render records and submit protocol commands.
- Keep projection logic in `@plot/session/projection`.

### `packages/cli/src/commands/api.ts`

New product command.

Subcommands/options:

- `plot api --stdio`
- `plot api --http --port <port>`
- Possibly `plot api --socket` only as hidden/debug if needed.

### `packages/cli/src/commands/runs.ts` or direct commands

Prefer direct root commands if citty ergonomics are good:

- `plot ls`
- `plot status <run-id>`
- `plot stop <run-id>`
- `plot logs <run-id>`

If direct root commands get noisy, use `plot runs ls`, but the preferred product surface is shorter.

## Implementation phases

### Phase 0 — land unrelated work

Commit or revert current unrelated changes before starting this refactor. In particular, do not mix SDK tool-boundary changes with CLI/run-registry renames.

### Phase 1 — rename registry owner in `@plot/session`

- Rename `fleet.ts` -> `run-registry.ts`.
- Rename `fleet-ipc.ts` -> `run-ipc.ts`.
- Rename exported types/functions:
  - `Fleet` -> `RunRegistry`
  - `FleetInstanceRecord` -> `RunRecord`
  - `FleetRuntime` -> `RunRegistryRuntime`
  - `FleetRequest` -> `RunIpcRequest` or `RunRequest`
  - `FleetResponse` -> `RunIpcResponse` or `RunResponse`
  - `startFleetIpcServer` -> `startRunIpcServer`
  - `sendFleetIpcRequest` -> `sendRunIpcRequest`
  - `resolveFleetIpcSocketPath` -> `resolveRunIpcSocketPath`
- Update `packages/session/package.json` exports and `public-api.test.ts`.
- Keep tests behavior-focused: spawn, early exit, recovery, replay/tail, disconnect.

### Phase 2 — make registry a workspace service

Current `FleetIpcOptions` defaults to `~/.plot/fleet`, which makes runs global and terminology stale.

Define the desired storage explicitly:

- Default run registry dir should be workspace-scoped under resolved Plot state, e.g. `<plotDir>/runs/registry.sock` and `<plotDir>/runs/runs.json`.
- If there is a strong reason for a user-global registry, document it and include cwd/workspace identity in every API. Do not accidentally mix unrelated workspaces.

Add `ensureRunRegistry(...)` in CLI/session boundary:

- If socket is live, use it.
- If socket is stale, remove it.
- If absent, start the registry owner in the current process or as a background child.

Do the laziest version that satisfies product UX:

- `plot web` can own the registry when it is the first process.
- `plot` TUI must either start/ensure the same registry or register its run with an existing registry.

### Phase 3 — TUI attaches to managed run

Change default `plot` flow:

1. Ensure run registry.
2. Spawn a run host through registry with cwd/workflow/options.
3. Open TUI attached to that run's protocol stream.
4. On quit, choose policy:
   - default: stop the run (current TUI lifecycle behavior), or
   - `--detach`: leave run alive.

Default should probably stop on quit to preserve today's mental model. Add detach only if needed.

Acceptance check:

```sh
plot --workflow examples/pr-review/WORKFLOW.md
# in another terminal
plot web
# web shows that run
```

### Phase 4 — web consumes the shared registry

Refactor `web-gateway.ts`:

- Do not always create a fresh registry universe.
- Use `ensureRunRegistry` / `sendRunIpcRequest` / stream attach.
- Serve HTTP API from the shared registry.
- Keep browser assets separate from API handlers.

HTTP endpoints should migrate from `/api/instances` to `/api/runs`.

Preferred endpoints:

- `GET /api/runs`
- `POST /api/runs`
- `GET /api/runs/:id`
- `DELETE /api/runs/:id`
- `GET /api/runs/:id/events?after=<sequence>`
- `GET /api/runs/:id/projection`
- `POST /api/runs/:id/requests` for protocol commands if needed by custom clients

Do not keep `/api/instances` unless tests/docs require a temporary compatibility path. If compatibility is kept, mark it explicitly as temporary and remove before release if possible.

### Phase 5 — product CLI

Replace primary CLI surface:

- Keep root `plot` as TUI.
- Keep `plot web` as dashboard.
- Keep `plot run` as headless run.
- Add:
  - `plot ls`
  - `plot status <run-id>`
  - `plot stop <run-id>`
  - `plot logs <run-id>`
  - `plot api --stdio`
  - `plot api --http`
- Remove or hide:
  - `plot instances`
  - `plot serve fleet`
  - `plot serve stdio`

If old commands remain during transition, they must not appear in root help. Prefer no aliases.

### Phase 6 — docs/tests/examples

Update:

- `README.md`
- `docs/quickstart.md`
- `docs/workflows.md`
- `docs/tui.md`
- `docs/extensions.md` if SDK/run wording appears
- `examples/pr-review/WORKFLOW.md`
- CLI tests
- web gateway tests
- public API tests

Grep must be clean for product surfaces:

```sh
rg "fleet|instance|serve stdio|serve fleet|supervisor|supervised" README.md docs packages examples
```

Allowed leftovers:

- Private migration notes in this PRD.
- Reference paths under `.references/`.
- Internal comments only if the implementation still has private `RunRegistry` history; prefer none.

## Tests that matter

Add/update behavior tests, not name-only churn.

1. **TUI-started run is discoverable by dashboard registry**
   - Start a managed run through the same path root `plot` uses, without full terminal rendering if possible.
   - Query run list API.
   - Assert the run appears with workflow/cwd/session metadata.

2. **Web uses existing registry**
   - Start registry with one run.
   - Start web gateway pointing at same workspace.
   - `GET /api/runs` returns that run.

3. **Custom API can spawn and stream**
   - Use stdio or in-process IPC client.
   - Spawn a run.
   - Attach event stream.
   - Assert replay/tail behavior after a sequence.

4. **Restart recovery remains correct**
   - Stale `online` / `starting` runs become `stopped`.

5. **Child exits before welcome remains error**
   - Preserve existing lifecycle torture test.

6. **CLI help exposes product nouns only**
   - Root help contains `web`, `run`, `ls`, `status`, `stop`, `logs`, `api`.
   - Root help does not contain `fleet`, `instances`, `serve stdio`, `serve fleet`, `supervisor`.

## Acceptance criteria

- Starting multiple `plot` TUIs creates/attaches to normal Plot runs.
- `plot web` shows those runs without manual daemon commands.
- Custom clients have one documented API surface: `plot api --stdio` and/or `plot api --http`.
- Primary docs use run/dashboard/API terminology.
- `@plot/session` remains the owner of runtime state, registry state, IPC/API decoding, and lifecycle.
- `@plot/tui` remains a frontend, not a runtime owner.
- `@plot/web` remains a frontend/API gateway, not a separate scheduler owner.
- `bun run check` passes.
- For release/package changes, `bun run release:local --version 0.0.0-test --skip-check` passes.

## Non-goals

- Multi-machine orchestration.
- Cloud control plane.
- Authenticated remote web server.
- A generic workflow engine.
- Rebuilding pi's agent/session internals.
- Compatibility aliases for old CLI nouns unless explicitly requested.

## Open decisions

1. **Run lifetime on TUI quit**
   - Default stop-on-quit preserves current behavior.
   - `--detach` can leave the run alive.

2. **Registry lifetime**
   - In-process owner is simpler.
   - Background daemon gives better cross-terminal UX.
   - Product requirement says cross-terminal discovery must work, so if in-process ownership is used, the process that owns the run must also expose itself to the shared registry.

3. **Workspace vs global registry**
   - Workspace-scoped better matches `plot web` showing runs for the current project.
   - Global can be useful, but must not make unrelated projects bleed into each other by default.

4. **HTTP API command naming**
   - `plot api --http` is clear for builders.
   - `plot web --api-only` is worse because it makes API subordinate to web.
