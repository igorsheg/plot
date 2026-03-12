<p align="center">
  <img src=".github/logo.svg" alt="plot" width="220" height="72" />
</p>

<p align="center">
  <a href="https://github.com/igorsheg/plot/actions"><img src="https://img.shields.io/github/actions/workflow/status/igorsheg/plot/ci.yml?branch=main&style=flat-square" alt="build status" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/github/license/igorsheg/plot?style=flat-square" alt="license" /></a>
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

plot has one built-in tracker: `github`. everything else goes through the tracker plugin contract.

at startup, plot:

1. reads `tracker.kind` from `WORKFLOW.md`
2. resolves a built-in tracker if the kind is known
3. otherwise dynamically imports the module named by `tracker.kind`
4. validates plugin config through the plugin's schema (if provided)
5. auto-discovers skills from a co-located `skills/` directory
6. resolves tools, hooks, and the tracker layer

add your own tracker type as:

- a package specifier: `@acme/plot-tracker-jira`
- a local module path: `./trackers/jira.ts`

### minimal plugin

```ts
import { Effect, Layer, Schema } from "effect";
import { TrackerClient, type TrackerPlugin } from "@plot/sdk";

const AcmeConfig = Schema.Struct({
  kind: Schema.String,
  endpoint: Schema.optional(Schema.String),
  apiKey: Schema.optional(Schema.String),
});
type AcmeConfig = typeof AcmeConfig.Type;

const plugin: TrackerPlugin<AcmeConfig> = {
  name: "acme",
  configSchema: AcmeConfig,
  factory: (config) =>
    Layer.succeed(
      TrackerClient,
      TrackerClient.of({
        fetchCandidateIssues: (_states) => Effect.succeed([]),
        fetchIssuesByStates: (_states) => Effect.succeed([]),
        fetchIssueStatesByIds: (_ids) => Effect.succeed([]),
        fetchRunContext: (_id, _state) => Effect.succeed(null),
      }),
    ),
};

export default plugin;
```

### plugin with tools

plugins can provide tools that get injected into the agent session. this is how tracker-specific write operations (state transitions, comments, PRs) reach the agent without encoding them in skill markdown.

```ts
const plugin: TrackerPlugin<AcmeConfig> = {
  name: "acme",
  configSchema: AcmeConfig,
  factory: (config) => makeAcmeClient(config),
  tools: (config) => [
    {
      name: "tracker_transition_issue",
      description: "Move an issue to a new state",
      parameters: Schema.Struct({
        issueId: Schema.String,
        fromState: Schema.String,
        toState: Schema.String,
      }),
      execute: (args) => /* tracker-specific logic */,
    },
  ],
  hooks: {
    onAgentFailed: (issue, error) =>
      Effect.logWarning(`agent failed on ${issue.identifier}: ${error}`),
  },
};
```

### skills auto-discovery

place skills in a `skills/` directory next to the plugin entrypoint. each subdirectory containing a `SKILL.md` is auto-discovered:

```
my-tracker-plugin/
├── index.ts              ← plugin entrypoint
└── skills/               ← auto-discovered
    ├── my-triage/
    │   └── SKILL.md
    └── my-sync/
        └── SKILL.md
```

the `skillPaths` field on `TrackerPlugin` is an escape hatch for non-standard layouts.

### workflow config

```yaml
tracker:
  kind: ./trackers/acme.ts
  endpoint: $ACME_ENDPOINT
  api_key: $ACME_API_KEY
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

- plot passes the whole `tracker:` block to the plugin's config schema for validation
- cli overrides still apply: `--tracker` replaces `tracker.kind`, `--github-repo` is forwarded as `githubRepo`
- plugins with a `configSchema` get validated config; without one, the raw object is passed through
- the tracker client has read methods (fetch issues, states, run context) and optional write methods (transition, comment, link PR)
- discriminated error types (`TrackerAuthError`, `TrackerRateLimitError`, `TrackerNotFoundError`, `TrackerNetworkError`, `TrackerValidationError`) enable intelligent retry behavior

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
