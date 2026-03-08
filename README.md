# plot

plot orchestrates coding agents against an issue tracker. it polls for issues, prepares isolated workspaces, renders a task prompt from [`WORKFLOW.md`](./WORKFLOW.md), and runs an agent command — exposing the runtime through a terminal or web dashboard.

## quick start

```bash
bun install
bun run plot -- web
```

this starts the server and opens the web dashboard. by default it reads `./WORKFLOW.md`, uses port `3000`, and uses the `local-fs` tracker.

for github tracking:

```bash
bun run plot -- web --tracker github --github-repo owner/repo
```

## configuration

all runtime configuration lives in [`WORKFLOW.md`](./WORKFLOW.md) — tracker settings, polling, workspace hooks, agent limits, and the prompt template rendered for each issue.

## development

```bash
bun run dev       # server + web via turbo
bun run check     # typecheck + lint + format
bun run test      # workspace tests
bun run build     # workspace builds
```
