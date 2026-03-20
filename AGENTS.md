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

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd sync
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**

- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
