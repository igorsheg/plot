<p align="center">
  <img src=".github/logo.svg" alt="plot" width="220" height="72" />
</p>

<p align="center">
  orchestrate coding agents against an issue tracker.
</p>

<p align="center">
  plot is a bun/typescript implementation in the lane of the <a href="https://github.com/openai/symphony/blob/main/SPEC.md">openai symphony spec</a> — the original spec for turning project work into isolated, autonomous implementation runs.
</p>

---

## quick start

plot reads `./WORKFLOW.md` for tracker config, state routing, hooks, and agent instructions. the workflow frontmatter defines which issue states are actionable — there are no built-in defaults.

1. create a `WORKFLOW.md` in your repo root (see below).
2. authenticate `gh` for the target repository.
3. run:

```bash
npx plot-ai
```

that drops you into an interactive terminal dashboard. for headless use (embedding, scripts, desktop apps), see `--mode rpc` below.

minimal `WORKFLOW.md`:

```md
---
tracker:
  kind: github
  dispatch_states:
    - plot:todo
    - plot:in-progress
    - plot:rework
    - plot:merging
  parked_states:
    - plot:human-review
  terminal_states:
    - plot:done
polling:
  interval_ms: 15000
workspace:
  root: ./workspaces
hooks:
  after_create: WS=$PWD && cd ../.. && rmdir "$WS" && git worktree add "$WS" HEAD --detach
  before_remove: WS=$PWD && cd ../.. && git worktree remove "$WS" --force || true
  timeout_ms: 120000
agent:
  model: anthropic/claude-sonnet-4-20250514
  max_concurrent_agents: 1
  max_turns: 50
  turn_timeout_ms: 1800000
  stall_timeout_ms: 300000
---

work on the assigned issue only.
keep diffs minimal.
prove changes with checks before claiming success.
```

a richer example with full state-machine instructions lives at [`packages/plot/examples/WORKFLOW.github.md`](packages/plot/examples/WORKFLOW.github.md).

## cli

plot exposes two run modes — interactive and headless — plus a handful of auth and catalog commands.

| command                          | description                                                       |
| -------------------------------- | ----------------------------------------------------------------- |
| `plot-ai`                        | terminal dashboard (default when run in a TTY)                    |
| `plot-ai --mode rpc`             | headless: JSON-RPC 2.0 notifications on stdout, commands on stdin |
| `plot-ai auth status`            | show auth state for configured oauth providers                    |
| `plot-ai auth login [provider]`  | log in to an oauth provider                                       |
| `plot-ai auth logout [provider]` | log out from an oauth provider                                    |
| `plot-ai models`                 | list available providers and models                               |

### shared flags

| flag                | default         | description                                                      |
| ------------------- | --------------- | ---------------------------------------------------------------- |
| `--workflow`        | `./WORKFLOW.md` | path to workflow file                                            |
| `--tracker`         | workflow value  | built-in tracker name or external plugin specifier               |
| `--github-repo`     | workflow value  | github repo in `owner/repo` form                                 |
| `--log-format`      | `pretty`        | log format: `pretty` or `json`                                   |
| `--verbose`         | `false`         | diagnostic output on stderr                                      |
| `--refresh-plugins` | `false`         | re-fetch npm tracker plugins, ignoring cached installations      |
| `--mode`            | (tui)           | `rpc` runs headless with JSON-RPC on stdio; omit for TUI mode    |

### headless mode (`--mode rpc`)

plot's embedding surface is a single process that speaks [JSON-RPC 2.0](https://www.jsonrpc.org/specification) over stdio. there is no HTTP server.

```bash
plot-ai --mode rpc --workflow ./WORKFLOW.md
```

- **stdout**: newline-delimited JSON-RPC notifications (`state/update`, `issue/event`, `log/message`)
- **stdin**: JSON-RPC requests (`focus`, `unfocus`, `stop`, `refresh`, `health`)
- **stderr**: human-readable diagnostics; `plot-rpc: ready` on successful startup
- **exit**: stdin close = graceful shutdown; non-zero exit = crash

this is the same protocol the terminal dashboard and the electron-based desktop app consume. build your own frontend by spawning plot-ai and reading NDJSON from its stdout — that's the entire integration contract.

the protocol types live in [`@plot/sdk`](packages/sdk/src/protocol.ts) and are plain typescript interfaces with zero runtime dependencies. a tiny sketch:

```ts
import { spawn } from "bun";
import type { ServerNotification } from "@plot/sdk";

const plot = spawn(["plot-ai", "--mode", "rpc"], {
  stdio: ["pipe", "pipe", "pipe"],
  cwd: "/path/to/my/project",
});

const decoder = new TextDecoder();
let buffer = "";
for await (const chunk of plot.stdout) {
  buffer += decoder.decode(chunk, { stream: true });
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim()) continue;
    const msg = JSON.parse(line) as ServerNotification;
    if (msg.method === "state/update") {
      console.log("running:", msg.params.snapshot.running.length);
    }
  }
}
```

## architecture

```
  ┌──────────────────────────────────────────────────────────┐
  │                     @plot/sdk                              │
  │  plain TS types · JSON-RPC protocol · plugin system        │
  └───────────────┬──────────────────────┬───────────────────┘
                  │                      │
        imports   │                      │  imports
                  ▼                      ▼
  ┌──────────────────────┐   ┌──────────────────────────────┐
  │     @plot/plot        │   │   consumers                   │
  │                       │   │                               │
  │  effect-ts core        │   │  @plot/tui       (terminal)   │
  │  orchestrator state    │◄──│  @plot/desktop    (electron)  │
  │  tracker plugins       │   │  external        (your app)   │
  │  agent lifecycle       │   │                               │
  │                       │   │  each spawns:                 │
  │  plot-ai --mode rpc    │   │   plot-ai --mode rpc          │
  │  stdin/stdout only     │   │   reads NDJSON stdout         │
  └──────────────────────┘   └──────────────────────────────┘
```

- **`@plot/sdk`** — plain typescript contracts. no effect, no runtime deps. defines the data shapes (`RuntimeSnapshot`, `AgentRuntimeEvent`, `Issue`), the JSON-RPC wire protocol, tracker plugin interfaces, and the error classes.
- **`@plot/plot`** — the orchestrator. effect-ts runtime, command queue, reconcile loop, dispatch/retry logic, tracker plugin loader. ships the `plot-ai` binary.
- **`@plot/tui`** — terminal dashboard. spawns `plot-ai --mode rpc` as a subprocess, renders live snapshots and event traces.
- **`@plot/desktop`** — electron-based control plane. one subprocess per project, fans snapshots into the webview via electrobun RPC. bundles a compiled `plot-ai` binary in the app image.

every consumer — tui, desktop, or a shell script — talks to plot the same way: spawn the subprocess, read JSON-RPC notifications, write commands to stdin. no http, no ports, no sockets.

## tracker plugins

plot ships with built-in trackers (`github`, `beads`). custom trackers use `defineTracker` from `@plot/sdk`:

```ts
import { defineTracker } from "@plot/sdk/plugin";

export default defineTracker({
  name: "acme",
  config(raw) {
    return { projectKey: raw.project_key as string };
  },
  async setup(ctx) {
    const client = await connect(ctx.config.projectKey);
    return { client };
  },
  async fetchCandidateIssues(ctx, dispatchStates) {
    return ctx.client.listIssues(dispatchStates);
  },
});
```

`defineTracker` provides a typed `ctx` to every method with your validated config and workflow states. the optional `setup()` hook runs once and returns shared resources (API clients, auth tokens) that are merged into `ctx` — no re-initialization per method call.

### plugin resolution

the `tracker.kind` field in `WORKFLOW.md` determines how the plugin is loaded:

| kind value                | resolution                                    |
| ------------------------- | --------------------------------------------- |
| `github`                  | built-in tracker                              |
| `beads`                   | built-in tracker                              |
| `./trackers/jira.ts`      | local file (relative to project dir)          |
| `/abs/path/tracker.ts`    | local file (absolute)                         |
| `~/my-tracker/index.ts`   | local file (tilde expands to `$HOME`)         |
| `@acme/plot-tracker-jira` | npm package (installed to `~/.plot/plugins/`) |

explicit prefixes are supported for clarity:

| kind value                       | resolution    |
| -------------------------------- | ------------- |
| `file:./trackers/jira.ts`        | local file    |
| `npm:@acme/plot-tracker-jira`    | npm package   |

npm plugins are installed on first use via `bun add` and cached by package name. the registry is auto-detected from the consumer repo's `.npmrc` or `.yarnrc.yml`. use `--refresh-plugins` to re-fetch the latest version.

tracker plugins are read-only clients — the coding agent handles all writes (state transitions, comments, pr links) using cli tools in the runtime environment.

## contributing

```bash
bun install
bun run check     # typecheck -> lint -> fmt check
bun run test      # workspace tests
bun run build     # workspace builds
bun run dev       # plot core dev loop
```

the repository is a bun workspace with these packages:

- `packages/sdk` — published as `@plot-ai/sdk`
- `packages/plot` — published as `plot-ai` (plus per-platform compiled binaries)
- `packages/tui` — private, consumed by `plot` only
- `packages/desktop` — private, electron app shell

## license

this project is licensed under the [MIT License](./LICENSE).
