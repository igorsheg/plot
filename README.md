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
4. validates plugin config with the plugin's `validateConfig` function (if provided)
5. auto-discovers skills from a co-located `skills/` directory
6. builds the tracker client layer

add your own tracker type as:

- a package specifier: `@acme/plot-tracker-jira`
- a local module path: `./trackers/jira.ts`

### minimal plugin

```ts
import type { TrackerPluginDefinition } from "@plot/sdk";

const plugin: TrackerPluginDefinition = {
	name: "acme",
	async factory() {
		return {
			async fetchCandidateIssues() {
				return [];
			},
			async fetchIssuesByStates() {
				return [];
			},
			async fetchIssueStatesByIds() {
				return [];
			},
			async fetchRunContext() {
				return null;
			},
		};
	},
};

export default plugin;
```

tracker plugins are read-only clients. the coding agent handles all tracker writes (state transitions, comments, pr links) using cli tools available in the runtime environment, guided by tracker-specific skills.

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

- plot passes the whole `tracker:` block to the plugin's `validateConfig` function
- cli overrides still apply: `--tracker` replaces `tracker.kind`, `--github-repo` is forwarded as `githubRepo`
- plugins with `validateConfig` get validated config; without it, the raw object is passed through
- the tracker client is read-only: fetch issues, states, and run context from the tracker
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
