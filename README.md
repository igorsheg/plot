# plot

plot orchestrates coding agents against an issue tracker.

it polls for issues in active states, prepares an isolated workspace (via git worktrees), renders a task prompt from `WORKFLOW.md`, and runs an agent command. runtime state is exposed through a terminal dashboard (tui) or a web dashboard.

## runtime shape

```text
issues ──> tracker ──> orchestrator ──> workspace manager ──> agent command
                │              │                 │                    │
                │              │                 │                    │
                │              │                 └──── renders prompt from
                │              │                       WORKFLOW.md
                │              │
                │              └──── retries, concurrency, timeouts
                │
                └──── local-fs or github

server ──> rpc + sse ──> tui
                  └───> web dashboard
```

## repo layout

```text
packages/
  plot/       runtime, cli, tracker adapters, orchestrator, bundled agent skills
  sdk/        typed schemas, rpc groups, client helpers, sse utilities
  tui/        terminal dashboard (@opentui/core)
  web/        browser dashboard (react 19, tanstack router, vite, tailwind v4)
```

## requirements

- bun >= 1.3.5
- a runnable agent command — default is `pi`, configured in `WORKFLOW.md`
- for github tracking: `gh` cli authenticated for the target repository

## quick start

```bash
bun install
```

launch the tui (starts server + terminal dashboard):

```bash
just plot
```

start the server headless:

```bash
just plot serve
```

start the server with the web dashboard:

```bash
just plot web
```

## cli

the cli binary is `plot-ai`. during development, run it through the justfile:

```bash
just plot [subcommand] [options]
```

### subcommands

| command | description |
|---------|-------------|
| *(default)* | start server and launch tui dashboard |
| `serve` | start the orchestrator server headless |
| `web` | start server and serve the web dashboard |
| `login [provider]` | login to a model provider |
| `logout [provider]` | logout from a model provider |
| `auth <status\|login\|logout> [provider]` | manage auth |

### common options

all subcommands accept:

```
--port <number>           server port (default: 3000)
--workflow <path>         path to WORKFLOW.md (default: ./WORKFLOW.md)
--tracker <local-fs|github>  tracker kind (default: local-fs)
--github-repo <owner/repo>   github repo for github tracker
--issues-dir <path>       local issues directory (default: ./issues)
--log-format <pretty|json>   server log format (default: pretty)
--json                    emit machine-readable ndjson on stdout
--quiet                   suppress non-error human output
```

### examples

```bash
# tui with github tracker
just plot --tracker github --github-repo owner/repo

# headless server on custom port
just plot serve --port 4000 --workflow ./WORKFLOW.md

# web dashboard against local issues
just plot web --tracker local-fs --issues-dir ./issues
```

## tracker modes

### local files

use markdown files in a directory (default `./issues`). a minimal issue file:

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

### github

reads issues through the `gh` cli and maps labels to workflow states.

```bash
just plot serve --tracker github --github-repo owner/repo
```

## workflow configuration

`WORKFLOW.md` is both config and prompt template.

the yaml frontmatter defines tracker settings, polling intervals, workspace hooks, agent limits, and server defaults. the markdown body is a liquid template rendered into the prompt given to the agent for each issue.

plot loads its bundled runtime skills from `packages/plot/resources/skills`. it also loads repo-local skills from `.agent/skills` and `.claude/skills` when those directories exist in the target workspace.

the checked-in `WORKFLOW.md` in this repo is the best reference for supported fields.

## development

common commands via justfile:

```bash
just dev          # server + web in parallel (watch mode)
just dev-server   # backend only (bun --watch)
just dev-web      # web only (vite dev)
just check        # typecheck + lint + format check
just test         # bun test
just build        # build all packages
just ui-add NAME  # add a coss ui component to web
just clean        # remove build artifacts and node_modules
```

equivalent bun scripts:

```bash
bun run dev:server    # watch mode backend
bun run dev:web       # vite dev
bun run typecheck     # tsc -b
bun run lint          # oxlint
bun run fmt           # oxfmt
bun run check         # typecheck + lint + fmt:check
bun run test          # bun test
bun run build         # build all packages
```

## environment variables

server config can also be set via env vars (see `.env.example`):

| variable | default | description |
|----------|---------|-------------|
| `PLOT_PORT` | `3000` | server port |
| `PLOT_WORKFLOW` | `./WORKFLOW.md` | workflow file path |
| `PLOT_TRACKER_KIND` | `local-fs` | tracker kind (`local-fs` or `github`) |
| `PLOT_ISSUES_DIR` | `./issues` | local issues directory |
| `PLOT_GITHUB_REPO` | — | github repo (`owner/repo`) |
| `PLOT_LOG_FORMAT` | `pretty` | log format (`pretty` or `json`) |
| `PLOT_LOG_LEVEL` | `info` | log level |
| `PLOT_WEB_DIST_DIR` | — | override packaged web assets path |
