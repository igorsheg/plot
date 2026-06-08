# AGENTS.md

## Scope

This file applies to the whole repository. If a closer `AGENTS.md` is added later, prefer the closest file.

## Reference repos

- Symphony spec/reference implementation: `.references/symphony`
- pi-mono SDK reference: `.references/pi-mono`

## Invariants

1. **Symphony core** — implement the core Symphony scheduler moat: `tick -> reconcile -> act`. The orchestrator is the single runtime-state owner; reconciliation always happens before dispatch.
2. **Effect native** — use Effect v4, currently `effect@4.0.0-beta.78`. For Effect work, load the `effect-ts` skill and follow current Effect v4 source patterns.
3. **pi-mono SDK** — use pi-mono as the LLM/agent SDK behind an `AgentRunner` seam. The orchestrator must not depend on provider or SDK details.

## Verification

For code changes, run:

```bash
bun run typecheck
bun run test
```
