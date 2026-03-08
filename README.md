# plot

plot orchestrates coding agents against an issue tracker.

it is informed by openai's [symphony](https://github.com/openai/symphony/tree/main) spec and repo, but implemented here against this codebase's own runtime, workflow file, and dashboards.

it polls for issues in active states, prepares an isolated workspace, renders a task prompt from `WORKFLOW.md`, runs an agent command, and exposes the runtime through a terminal or web dashboard.

## what is in this repo

- a tracker layer with two backends: local files and github
- an orchestrator that loads workflow config, schedules runs, manages retries, and creates workspaces
- a server that exposes runtime state
- two dashboards: a tui and a web app
- a product package that contains the runtime, cli, and publish launcher assets
- embedded plot agent resources in `packages/plot/resources`

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

## requirements

- bun 1.3.5
- a runnable agent command. the default is `pi`, configured through `WORKFLOW.md`
- for github tracking: `gh` authenticated for the target repository

## quick start

install dependencies:

```bash
bun install
```

start the default dashboard:

```bash
bun run plot
```

start the server without a dashboard:

```bash
bun run plot -- serve
```

open the web dashboard:

```bash
bun run plot -- web
```

by default the cli reads `./WORKFLOW.md`, uses port `3000`, and uses the `local-fs` tracker unless told otherwise.

## tracker modes

### local files

use markdown files in a directory, default `./issues`.

a minimal issue file looks like this:

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

run against local issues:

```bash
bun run plot -- serve --tracker local-fs --issues-dir ./issues
```

### github

github mode reads issues through the `gh` cli and maps labels to workflow states.

run against a repository:

```bash
bun run plot -- serve --tracker github --github-repo owner/repo
```

## workflow configuration

`WORKFLOW.md` is both config and prompt template.

the yaml frontmatter defines tracker settings, polling, workspace hooks, agent limits, and server defaults. the markdown body is rendered into the prompt given to the agent for each issue.

plot always loads its bundled runtime skills. it also loads repo-local skills from `.agent/skills` and `.claude/skills` when those directories exist in the target workspace. user-global pi skills are ignored.

this repo's checked-in `WORKFLOW.md` is the best reference because it exercises most of the supported fields.

## repo layout

```text
packages/
  plot/       runtime, cli, publish launcher, tracker adapters, orchestrator
  sdk/        typed client helpers, schemas, rpc, shared consumer utilities
  tui/        terminal dashboard
  web/        browser dashboard
  plot/resources/ embedded plot skills for bundled runs
```

## development

common commands:

```bash
bun run dev       # server + web via turbo
bun run check     # typecheck + lint + format check
bun run test      # workspace tests via turbo
bun run build     # workspace builds via turbo
```

if you want the web app only:

```bash
bun run dev:web
```

if you want the backend only:

```bash
bun run dev:server
```

## notes

- the cli entrypoint is `packages/plot/src/cli`
- the default command launches the server and tui together
- `serve` runs headless
- `web` starts the server and opens the browser dashboard
- server config can also be provided through env vars such as `PLOT_PORT`, `PLOT_WORKFLOW`, `PLOT_TRACKER_KIND`, and `PLOT_GITHUB_REPO`
