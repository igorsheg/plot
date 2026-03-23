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

## tracker plugins

plot ships with one built-in tracker: `github`. custom trackers implement `TrackerPluginDefinition` from `@plot/sdk` and are referenced in `WORKFLOW.md` as a package specifier (`@acme/plot-tracker-jira`) or local path (`./trackers/jira.ts`).

```ts
import type { TrackerPluginDefinition } from "@plot/sdk";

const plugin: TrackerPluginDefinition = {
  name: "acme",
  async factory() {
    return {
      async fetchCandidateIssues() {
        return [];
      },
    };
  },
};

export default plugin;
```

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
