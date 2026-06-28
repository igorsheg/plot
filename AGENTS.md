# AGENTS.md

## Scope

This file applies to the whole repository. If a closer `AGENTS.md` is added later, prefer the closest file.

## Reference repos

- Symphony spec/reference implementation: `.references/symphony`
- pi-mono SDK reference: `.references/pi-mono`

## Invariants

1. **Plot agent** — implement the Symphony-inspired scheduler moat: `tick -> reconcile -> act`. The Plot agent is the single runtime-state owner; reconciliation always happens before dispatch.
2. **Do not cripple agent sessions** — Plot should make agents cheaper and better by shaping context and ownership, not by micromanaging reasoning. Scheduling must not become a rigid programmatic pipeline. `@plot/agent` owns wakeups, state, reconciliation, runtime policy, lifecycle, and auditability. Sources and agent sessions own their inner reasoning, tool strategy, and task execution inside coarse runtime seams.
3. **Sources are trusted code** — sources observe the world, reconcile facts, and write normal TypeScript code to decide what to do next. `@plot/agent` schedules selected work and tracks running attempts; sources decide whether completions mean done, retry, continuation, or new work. The agent must not invent a fine-grained capability/grant DSL for every inner tool or command the agent session may choose.
4. **Plain TypeScript runtime** — use async/await, async iterables, explicit queues/event streams, and tagged boundary errors. Do not introduce framework-owned runtime machinery.
5. **pi-mono SDK** — use pi-mono as the agent-session SDK behind `@plot/session`'s agent-session client/runner seam. `@plot/agent` must not depend on provider or SDK details.
6. **TUI boundary** — Plot TUI is generic over sources/plugins. Extensions may contribute display metadata, but `@plot/tui` must not contain plugin-specific concepts such as GitHub PRs, severity badges, or review workflow labels. Use the Plot terminal substrate in `packages/tui/src/terminal-ui.ts` for terminal mechanics; Plot-owned code should only model Plot product concepts.
7. **Release shape** — distribute the CLI as Bun single-executable platform packages behind the npm umbrella package `plot-ai`, exposing the binary as `plot`. Releases are tag-driven from `v*` tags; keep release machinery in `scripts/release` aligned with `packages/cli/src/main.ts`.
8. **Tests must mean something** — prefer 1-2 behavior tests that prove important contracts over 50 shallow AI-slop tests. Do not add tests just to spray green checkmarks.
9. **Import directly** — do not add barrel modules that re-export another module's source. If a callsite needs a symbol, import it from the module that owns it.
10. **Directories are earned** — avoid single-file directories. Start with `module.ts`; create `module/` only when the directory represents a real multi-file module boundary.

## Verification

For code changes, run:

```bash
bun run check
```

For release/package changes, also run:

```bash
bun run release:local --version 0.0.0-test --skip-check
```
