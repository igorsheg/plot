<p align="center">
  <img src=".github/logo.svg" alt="plot" width="220" height="72" />
</p>

<p align="center">orchestrate coding agents against an issue tracker.</p>

---

## usage

```bash
npx plot-ai
```

this starts the server + tui dashboard. plot reads `WORKFLOW.md` from the current directory for tracker config and prompt templates.

### commands

| command | description |
|---|---|
| `plot-ai` | server + tui dashboard (default) |
| `plot-ai serve` | headless server |
| `plot-ai web` | server + browser dashboard |
| `plot-ai auth status` | check auth state |
| `plot-ai auth login [provider]` | login to a model provider |
| `plot-ai auth logout [provider]` | logout from a model provider |

### options

shared across `plot-ai`, `serve`, and `web`:

| flag | default | description |
|---|---|---|
| `--port` | `3000` | server port |
| `--workflow` | `./WORKFLOW.md` | path to workflow file |
| `--tracker` | — | tracker backend (`local-fs` or `github`) |
| `--github-repo` | — | github repo (`owner/repo`) for github tracker |
| `--issues-dir` | — | local issues directory |
| `--json` | `false` | ndjson output (serve only) |
| `--quiet` | `false` | suppress non-error output |
| `--log-format` | `pretty` | server log format (`pretty` or `json`) |

### configuration

`WORKFLOW.md` is both config and prompt template. yaml frontmatter defines tracker settings, polling, workspace hooks, agent limits, and server defaults. the markdown body becomes the prompt given to the agent for each issue.

environment overrides:

| variable | default | description |
|---|---|---|
| `PLOT_PORT` | `3000` | server port |
| `PLOT_WORKFLOW` | `./WORKFLOW.md` | workflow file path |
| `PLOT_TRACKER_KIND` | `local-fs` | tracker backend (`local-fs` or `github`) |
| `PLOT_GITHUB_REPO` | — | github repo in `owner/repo` form |

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

## development

```bash
bun install              # install deps
bun run dev              # server + web via turbo
bun run check            # typecheck → lint → fmt
bun run test             # workspace tests via turbo
bun run build            # workspace builds via turbo
```

### requirements

- bun 1.3.5+
- a runnable agent command (default: `pi`, configured in `WORKFLOW.md`)
- for github tracking: `gh` cli authenticated for the target repo
