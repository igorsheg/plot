<p align="center">
  <img src=".github/logo.svg" alt="plot" width="220" height="72" />
</p>

<p align="center">orchestrate coding agents against an issue tracker.</p>

---

plot polls for issues in active states, prepares isolated workspaces, renders task prompts from a workflow file, runs an agent command, and exposes runtime state through a web or terminal dashboard.

informed by openai's [symphony](https://github.com/openai/symphony) spec.

## repo layout

```text
packages/
  plot/   runtime, cli, tracker adapters, orchestrator, embedded agent skills
  sdk/    typed schemas, rpc groups, client helpers, sse utilities
  tui/    terminal dashboard
  web/    browser dashboard (tanstack spa)
```

## stack

- **runtime**: bun, typescript strict, effect ts (services, layers, fibers, refs, schedules)
- **backend**: @effect/rpc, @effect/platform-bun
- **frontend**: react 19, tanstack router + query, vite
- **ui**: coss ui (tailwind v4), compound components, system dark/light mode
- **quality**: oxlint, oxfmt

## requirements

- bun 1.3.5+
- a runnable agent command (default: `pi`, configured in `WORKFLOW.md`)
- for github tracking: `gh` cli authenticated for the target repo

## quick start

```bash
bun install
```

start server + web dashboard:

```bash
bun run dev
```

server only:

```bash
bun run dev:server
```

web only:

```bash
bun run dev:web
```

run via cli:

```bash
bun run plot
```

## development

```bash
bun run dev         # server + web via turbo
bun run check       # typecheck → lint → fmt
bun run test        # workspace tests via turbo
bun run build       # workspace builds via turbo
bun run ui:add -- @coss/NAME   # add coss ui component to web
```

## configuration

`WORKFLOW.md` is both config and prompt template. yaml frontmatter defines tracker settings, polling, workspace hooks, agent limits, and server defaults. the markdown body becomes the prompt given to the agent for each issue.

environment overrides:

| variable | default | description |
|---|---|---|
| `PLOT_PORT` | `3000` | server port |
| `PLOT_WORKFLOW` | `./WORKFLOW.md` | workflow file path |
| `PLOT_TRACKER_KIND` | `local-fs` | tracker backend (`local-fs` or `github`) |
| `PLOT_GITHUB_REPO` | — | github repo in `owner/repo` form |

see `.env.example` for the full list.

## cli

the entrypoint is `packages/plot/src/cli`. default command launches server + tui. other modes:

- `serve` — headless server
- `web` — server + browser dashboard
