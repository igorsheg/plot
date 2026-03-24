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

plot reads `./WORKFLOW.md` for tracker config, state routing, and agent instructions. the workflow frontmatter defines which issue states are actionable — there are no built-in defaults.

1. create a `WORKFLOW.md` in your repo root (see below).
2. authenticate `gh` for the target repository.
3. run:

```bash
npx plot-ai
```

minimal `WORKFLOW.md`:

```md
---
tracker:
  kind: github
  dispatch_states:
    - plot:todo
    - plot:in-progress
  parked_states:
    - plot:human-review
  terminal_states:
    - plot:done
    - Closed
workspace:
  root: ./workspaces
server:
  port: 3000
---

work on the assigned issue only.
keep diffs minimal.
prove changes with checks before claiming success.
```

## cli commands

| command                          | description                                    |
| -------------------------------- | ---------------------------------------------- |
| `plot-ai`                        | start the server and launch the tui dashboard  |
| `plot-ai serve`                  | start the orchestrator server without a ui     |
| `plot-ai web`                    | start the server and serve the web dashboard   |
| `plot-ai auth status`            | show auth state for configured oauth providers |
| `plot-ai auth login [provider]`  | log in to an oauth provider                    |
| `plot-ai auth logout [provider]` | log out from an oauth provider                 |

shared flags for `plot-ai`, `serve`, and `web`:

| flag            | default         | description                                                      |
| --------------- | --------------- | ---------------------------------------------------------------- |
| `--port`        | `3000`          | server port                                                      |
| `--workflow`    | `./WORKFLOW.md` | path to workflow file                                            |
| `--tracker`     | workflow value  | built-in tracker name or external plugin specifier               |
| `--github-repo` | workflow value  | github repo in `owner/repo` form                                 |
| `--log-format`  | `pretty`        | server log format: `pretty` or `json`                            |
| `--verbose`     | `false`         | enable non-error human output (quiet by default)                 |
| `--json`        | `false`         | machine-readable ndjson output on stdout. practical with `serve` |
| `--refresh-plugins` | `false`    | re-fetch npm tracker plugins, ignoring cached installations      |

## tracker plugins

plot ships with built-in trackers (`github`, `beads`). custom trackers use `defineTracker` from `@plot/sdk`:

```ts
import { defineTracker } from "@plot/sdk";

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

| kind value | resolution |
|---|---|
| `github` | built-in tracker |
| `./trackers/jira.ts` | local file (relative to cwd) |
| `/abs/path/tracker.ts` | local file (absolute) |
| `~/my-tracker/index.ts` | local file (tilde expands to home) |
| `@acme/plot-tracker-jira` | npm package (installed to `~/.plot/plugins/`) |

explicit prefixes are supported for clarity:

| kind value | resolution |
|---|---|
| `file:./trackers/jira.ts` | local file |
| `npm:@acme/plot-tracker-jira` | npm package |

npm plugins are installed on first use via `bun add` and cached by package name. the registry is auto-detected from the consumer repo's `.npmrc` or `.yarnrc.yml`. use `--refresh-plugins` to re-fetch the latest version.

tracker plugins are read-only clients — the coding agent handles all writes (state transitions, comments, pr links) using cli tools in the runtime environment.

## contributing

```bash
bun install
bun run check     # typecheck -> lint -> fmt check
bun run test      # workspace tests
bun run build     # workspace builds
bun run dev       # plot server + web app
```

## license

this project is licensed under the [MIT License](./LICENSE).
