# plot

orchestrates coding agents against an issue tracker. see `SPEC.md` alignment with [symphony](https://github.com/openai/symphony).

## commands

run `just` for the full list. key recipes:

```
bun run dev       # server + web via turbo
bun run check     # typecheck → lint → fmt
bun run test      # workspace tests via turbo
bun run build     # workspace builds via turbo
bun run ui:add -- @coss/NAME  # add coss ui component to web
```

## structure

```
packages/
  plot/      — main product package: runtime implementation, cli, and release launcher assets
  sdk/       — shared api surface: schemas, rpc groups, client helpers, sse utilities
  web/       — tanstack SPA dashboard
```

## stack

- **runtime**: bun 1.3.5, typescript strict
- **backend**: effect ts (services, layers, fibers, refs, schedules), @effect/rpc, @effect/platform-bun
- **frontend**: react 19, tanstack router, tanstack query, vite
- **ui**: coss ui (base ui + tailwind v4), `@/` path alias, compound components
- **quality**: oxlint, oxfmt

## conventions

- no `any`, no linter suppressions
- effect services use `Effect.Service` pattern
- errors are `Schema.TaggedError`
- shared api surface lives in `@plot/sdk`; runtime implementation lives in `@plot/plot`
- ui: compound components with context (`state`/`actions`/`meta`), `use()` for context (react 19)
- ui: monochrome + selective color, system dark/light mode
- ui: coss token system (`--background`, `--foreground`, `--card`, `--muted`, `--border`, etc.)

## do not

- add dependencies without checking if an equivalent exists in the monorepo
- use `forwardRef` — react 19, pass ref as prop
- use render props or boolean prop proliferation — compose with children
- put `"use client"` directives — this is vite, not next.js
- commit generated coss ui component files (`components/ui/*`) with manual edits unless intentional
- use relative `.js` imports in web — use `@/` alias
