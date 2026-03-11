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

plot looks for `./WORKFLOW.md` by default, uses `github` as the built-in tracker, and expects `gh` auth for github-backed runs.

1. create a `WORKFLOW.md` in your repo root.
2. authenticate `gh` for the target repository.
3. start plot:

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

for the built-in github tracker, unlabeled issues are ignored. plot only routes issues with an explicit `plot:*` state label.

that starts the server and launches the tui dashboard. for a browser dashboard instead, run `npx plot-ai web`.

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

## plugin system

plot has one built-in tracker today: `github`. everything else goes through the tracker plugin contract.

at startup, plot:

1. reads `tracker.kind` from `WORKFLOW.md`
2. resolves a built-in tracker if the kind is known
3. otherwise dynamically imports the module named by `tracker.kind`
4. reads the module's default export as a tracker plugin
5. calls `factory(config)` to get a tracker layer

that means you can add your own tracker type as:

- a package specifier, like `@acme/plot-tracker-jira`
- a local module path, like `./trackers/jira.ts`

### `TrackerPlugin` interface

```ts
interface TrackerPlugin {
  readonly name: string;
  readonly factory: (config: TrackerPluginConfig) => Layer.Layer<TrackerClient>;
  readonly skillPaths?: ReadonlyArray<string>;
}
```

| field        | required | description                                                                                              |
| ------------ | -------- | -------------------------------------------------------------------------------------------------------- |
| `name`       | yes      | human-readable plugin identifier                                                                         |
| `factory`    | yes      | receives the normalized tracker config, returns an effect `Layer` providing `TrackerClient`               |
| `skillPaths` | no       | absolute paths to skill directories the plugin ships. these are loaded into every agent session it spawns |

### plugin skills

a tracker plugin can ship its own skills by declaring `skillPaths`. each entry is an absolute path to a skill directory containing a `SKILL.md`. the built-in github tracker uses this to provide skills like `plot-github-tracker`, `plot-push-pr`, `plot-land`, and `plot-debug`.

directory convention — colocate a `skills/` folder next to the plugin's `index.ts`:

```
trackers/acme/
├── index.ts          # default export: TrackerPlugin
└── skills/
    ├── acme-triage/
    │   └── SKILL.md
    └── acme-sync/
        └── SKILL.md
```

then reference them from the plugin:

```ts
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const skillsDir = join(dirname(fileURLToPath(import.meta.url)), "skills");

const plugin: TrackerPlugin = {
  name: "acme",
  skillPaths: [
    join(skillsDir, "acme-triage"),
    join(skillsDir, "acme-sync"),
  ],
  factory: (config: TrackerPluginConfig) =>
    Layer.succeed(
      TrackerClient,
      TrackerClient.of({
        fetchCandidateIssues: (_dispatchStates) => Effect.succeed([]),
        fetchIssuesByStates: (_states) => Effect.succeed([]),
        fetchIssueStatesByIds: (_ids) => Effect.succeed([]),
        fetchRunContext: (_issueId, _state) => Effect.succeed(null),
      }),
    ),
};

export default plugin;
```

### skill loading order

when plot spawns an agent session, it merges skills from three sources in order:

1. **core skills** — built-in skills shipped with plot (e.g. `plot-commit`, `plot-pull-main`)
2. **tracker plugin skills** — skills declared in the plugin's `skillPaths`
3. **workspace skills** — repo-local skill directories discovered in the workspace

all sources go through the same `resolvePlugin` path — built-in trackers like `github` and external plugins are treated identically. the resolved `skillPaths` are threaded through config and passed to the agent adapter at session creation time.

### minimal plugin example (no skills)

```ts
import { Effect, Layer } from "effect";
import {
  TrackerClient,
  type TrackerPlugin,
  type TrackerPluginConfig,
} from "@plot/sdk";

const plugin: TrackerPlugin = {
  name: "acme",
  factory: (config: TrackerPluginConfig) =>
    Layer.succeed(
      TrackerClient,
      TrackerClient.of({
        fetchCandidateIssues: (_dispatchStates) => Effect.succeed([]),
        fetchIssuesByStates: (_states) => Effect.succeed([]),
        fetchIssueStatesByIds: (_ids) => Effect.succeed([]),
        fetchRunContext: (_issueId, _state) => Effect.succeed(null),
      }),
    ),
};

export default plugin;
```

wire it up in `WORKFLOW.md`:

```yaml
tracker:
  kind: ./trackers/acme.ts
  endpoint: $ACME_ENDPOINT
  api_key: $ACME_API_KEY
  project_slug: my-project
  dispatch_states:
    - plot:todo
    - plot:in-progress
  parked_states:
    - plot:human-review
  terminal_states:
    - plot:done
    - Closed
```

notes:

- plot passes the whole `tracker` block to the plugin as config, with yaml keys normalized to camelCase
- cli overrides still apply. `--tracker` replaces `tracker.kind`, and `--github-repo` is forwarded as `githubRepo`
- the plugin is responsible for validating its own config
- the tracker client contract is small on purpose: fetch candidate issues, fetch issues by state, refresh issue states by id, and fetch per-issue run context

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
