# plot

plot orchestrates coding agents against an issue tracker.

it polls for issues in active states, prepares an isolated workspace (via git worktree), renders a task prompt from `WORKFLOW.md`, and runs an agent command. runtime state is exposed through a TUI or web dashboard.

```text
issues ──> tracker ──> orchestrator ──> workspace manager ──> agent command
                │              │                 │
                │              │                 └── renders prompt from
                │              │                     WORKFLOW.md
                │              │
                │              └── retries, concurrency, timeouts
                │
                └── local-fs or github

server ──> rpc + sse ──> tui
                  └───> web dashboard
```

## repo layout

```text
packages/
  plot/      runtime, cli, tracker adapters, orchestrator, bundled agent skills
  sdk/       typed schemas, rpc groups, client helpers, sse utilities
  tui/       terminal dashboard (@opentui)
  web/       browser dashboard (react 19, tanstack router, vite)
```

## requirements

- bun >= 1.3.5
- a runnable agent command (default: `pi`, configured in `WORKFLOW.md`)
- for github tracking: `gh` cli authenticated for the target repository

## quick start

```bash
bun install
```

launch the TUI dashboard (default command — starts server + tui):

```bash
just plot
```

start the server headless:

```bash
just plot serve
```

start the server and serve the web dashboard:

```bash
just plot web
```

## cli

the cli binary is `plot-ai`. during development, run it via `just plot` or directly:

```bash
bun run packages/plot/src/cli/index.ts
```

### subcommands

| command | description |
|---------|-------------|
| *(default)* | start server and launch TUI dashboard |
| `serve` | start the orchestrator server headless |
| `web` | start server and serve the web dashboard |
| `login [provider]` | login to a model provider |
| `logout [provider]` | logout from a model provider |
| `auth <status\|login\|logout> [provider]` | manage auth credentials |

### common flags

all server-backed commands accept:

```
--port <number>          server port (default: 3000)
--workflow <path>        path to WORKFLOW.md (default: ./WORKFLOW.md)
--tracker <local-fs|github>  tracker kind (default: local-fs)
--github-repo <owner/repo>   github repo for github tracker
--issues-dir <path>      local issues directory (default: ./issues)
--log-format <pretty|json>   server log format (default: pretty)
--json                   emit machine-readable ndjson on stdout
--quiet                  suppress non-error human output
```

## tracker modes

### local files

use markdown files in a directory (default `./issues`):

```md
---
id: 1
identifier: plot-1
title: add retry backoff
state: Todo
labels: [backend]
---

implement exponential backoff for failed runs.
```

```bash
just plot serve --tracker local-fs --issues-dir ./issues
```

### github

reads issues through the `gh` cli and maps labels to workflow states:

```bash
just plot serve --tracker github --github-repo owner/repo
```

## workflow configuration

`WORKFLOW.md` is both config and prompt template.

the yaml frontmatter defines tracker settings, polling intervals, workspace hooks, agent limits, and server defaults. the markdown body is a liquid template rendered into the prompt given to the agent for each issue.

plot loads its bundled runtime skills from `packages/plot/resources/skills`. it also loads repo-local skills from `.agent/skills` and `.claude/skills` when those directories exist in the target workspace.

the checked-in `WORKFLOW.md` in this repo exercises most supported fields.

## environment variables

settings can also be provided through env vars (see `.env.example`):

| variable | description | default |
|----------|-------------|---------|
| `PLOT_PORT` | server port | `3000` |
| `PLOT_WORKFLOW` | workflow file path | `./WORKFLOW.md` |
| `PLOT_TRACKER_KIND` | `local-fs` or `github` | `local-fs` |
| `PLOT_ISSUES_DIR` | local issues directory | `./issues` |
| `PLOT_GITHUB_REPO` | github repo (`owner/repo`) | — |
| `PLOT_LOG_FORMAT` | `pretty` or `json` | `pretty` |
| `PLOT_LOG_LEVEL` | `debug`, `info`, `warning`, `error`, `none` | `info` |
| `PLOT_WEB_DIST_DIR` | packaged web assets override | — |

## development

```bash
just dev           # server + web in parallel
just dev-server    # backend only (watch mode)
just dev-web       # vite frontend only
just check         # typecheck + lint + format check
just test          # bun test
just build         # build all packages
just ui-add NAME   # add a coss ui component to web
just clean         # remove build artifacts and node_modules
```

## stack

- **runtime**: bun, typescript strict, effect ts
- **backend**: @effect/rpc, @effect/platform-bun, liquidjs templates
- **frontend**: react 19, tanstack router, tanstack query, vite, tailwind v4
- **ui**: coss ui components, @opentui for tui
- **quality**: oxlint, oxfmt
