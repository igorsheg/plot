# AGENTS.md

Repo-wide instructions. Prefer a closer `AGENTS.md` if one exists.

## Commands

- Code changes: `bun run check`
- Release/package changes: also `bun run release:local --version 0.0.0-test --skip-check`
- Do not add shallow tests. Add the smallest behavior test that proves the contract.

## Architecture rules

- Plot agent owns runtime state: `tick -> reconcile -> act`. Reconcile before dispatch.
- Sources are trusted TypeScript. They observe, reconcile facts, and decide whether work is done, retried, continued, or replaced.
- Agent sessions own their inner reasoning and tool strategy. Do not turn scheduling into a fine-grained grant/pipeline DSL.
- Keep runtime code plain TypeScript: async/await, async iterables, queues/event streams, tagged boundary errors.
- `@plot/session` owns the pi-mono SDK seam. `@plot/agent` must not depend on provider/SDK details.
- TUI is generic over Plot concepts. No GitHub PR/review/severity concepts in `@plot/tui`; use `packages/tui/src/terminal-ui.ts` for terminal mechanics.
- Web Console is Fleet + Masthead + Column + pinned Floor + Palette; scrub replay swaps projection through `session-context.tsx`, `palette.tsx` runs `commands.ts`, and `replay.ts` stays limited to fetchable run events.
- CLI release shape: Bun single-executable platform packages behind npm package `plot-ai`, binary `plot`, tag-driven from `v*`.

## Code style

- Import symbols from the module that owns them. No barrel modules that only re-export.
- Directories are earned. Start with `module.ts`; create `module/` only for a real multi-file boundary.
- Prefer deletion and small seams over speculative abstraction.

## References

- Symphony spec/reference: `.references/symphony`
- pi-mono SDK reference: `.references/pi-mono`
