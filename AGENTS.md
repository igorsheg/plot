# AGENTS.md

## Scope

This file applies to the whole repository. If a closer `AGENTS.md` is added later, prefer the closest file.

## Reference repos

- Symphony spec/reference implementation: `.references/symphony`
- pi-mono SDK reference: `.references/pi-mono`

## Invariants

1. **Symphony core** — implement the core Symphony scheduler moat: `tick -> reconcile -> act`. The orchestrator is the single runtime-state owner; reconciliation always happens before dispatch.
2. **Do not cripple agents** — orchestration must not become a rigid programmatic pipeline that micromanages agent reasoning. Plot core owns wakeups, durable state, reconciliation, runtime policy, lifecycle, and auditability. Agents/sources own their inner reasoning, tool strategy, and task execution inside coarse runtime seams.
3. **Sources are trusted code** — sources observe the world, reconcile facts, and write normal TypeScript/Effect code to decide what to do next. Core schedules selected work and tracks running attempts; sources decide whether completions mean done, retry, continuation, or new work. Core must not invent a fine-grained capability/grant DSL for every inner tool or command the agent may choose.
4. **Effect native** — use Effect v4, currently `effect@4.0.0-beta.78`. For Effect work, load the `effect-ts` skill and follow current Effect v4 source patterns.
5. **pi-mono SDK** — use pi-mono as the LLM/agent SDK behind an `AgentRunner` seam. The orchestrator must not depend on provider or SDK details.
6. **Tests must mean something** — prefer 1-2 behavior tests that prove important contracts over 50 shallow AI-slop tests. Do not add tests just to spray green checkmarks.
7. **Import directly** — do not add barrel modules that re-export another module's source. If a callsite needs a symbol, import it from the module that owns it.
8. **Directories are earned** — avoid single-file directories. Start with `module.ts`; create `module/` only when the directory represents a real multi-file module boundary.

## Verification

For code changes, run:

```bash
bun run typecheck
bun run test
```
