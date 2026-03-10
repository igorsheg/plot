# AGENTS.md

## scope

- this file applies to the whole monorepo.
- no package-local `AGENTS.md` files exist yet. if a closer one is added later, prefer the closest file over this root file.
- treat `README.md`, `WORKFLOW.md`, and package-local config as the source of truth for discoverable commands and architecture.

## landmines

- `packages/web/components/ui/*` are generated from the coss ui registry. do not hand-edit them. use `bun run ui:add` from the repo root when that surface needs to change.
- follow the existing effect style: services use `Effect.Service`, and typed effect errors use `Schema.TaggedError`.
- react 19 code in this repo does not use `forwardRef`. match nearby components instead of reintroducing it.

## verification

- run verification from the repo root in this order: `bun run typecheck`, `bun run lint`, `bun run test`, `bun run build`.
