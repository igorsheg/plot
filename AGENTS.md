# AGENTS.md

## Scope

- This file applies to the whole repository.
- Plot is being rebuilt from a clean alpha branch. Do not assume any previous `packages/*`, release scripts, Docker assets, or workflow files still exist.
- If a closer `AGENTS.md` is added later, prefer the closest file.

## Product invariant

Plot implements the core of the OpenAI Symphony service specification:

- Reference: <https://github.com/openai/symphony/blob/main/SPEC.md>
- Local reference used for this reset: `~/.cache/checkouts/github.com/openai/symphony/SPEC.md`

The moat is the orchestrator loop. Keep it small, explicit, and correct:

1. **Tick** — the single time owner. A tick begins one serialized scheduler decision cycle.
2. **Reconcile** — always run before new work. Refresh running issue states, detect stalls, stop ineligible runs, clean terminal workspaces.
3. **Act** — validate dispatch config, fetch active candidates, sort by priority, claim eligible issues, dispatch within bounds, or schedule/release retries.

Do not dilute this into a generic workflow engine. Plot is a scheduler/runner for coding-agent work, not a broad automation platform.

## Architecture invariants

- One orchestrator owner mutates runtime state: `running`, `claimed`, retry queue, session metrics, and event log state.
- Cross-owner communication is data: commands, completions, tracker snapshots, agent events.
- Reconciliation before dispatch is mandatory.
- Dispatch is bounded by global and per-state concurrency.
- Retry/backoff is explicit and observable.
- Restart recovery is tracker/filesystem-driven; do not add a database unless a concrete invariant requires it.
- Workspaces are deterministic per issue identifier and persistent across attempts unless terminal cleanup applies.
- Tracker writes and PR/comment policy belong to the agent/workflow policy, not core scheduler business logic.

## Technology invariants

- Plot is Effect v4 native.
- Current baseline dependency: `effect@4.0.0-beta.78`.
- Use `ServiceMap.Service` for services, `Layer` for dependency wiring, `Effect.fn` for service methods, and `Schema.TaggedErrorClass` for typed Effect errors.
- Before writing or reviewing Effect code, load the `effect-ts` skill and consult current Effect source. Prefer repo-local `.agent-sources/effect/` and keep it out of commits.
- The LLM/agent infrastructure behind the scheduler is pi-mono used as an SDK. Keep this behind an `AgentRunner` seam so the orchestrator never depends on provider details.
- TypeScript extensions may call Node/Bun stdlib. Keep extension execution behind explicit seams; do not let extension code mutate orchestrator state directly.

## Initial module shape

Start boring and deep:

- `src/domain` — Symphony domain model and pure eligibility/sorting/retry rules.
- `src/orchestrator` — tick/reconcile/act owner loop and runtime state authority.
- `src/workflow` — `WORKFLOW.md` parser/config view when workflow support returns.
- `src/tracker` — tracker client contract and adapters.
- `src/workspace` — deterministic workspace mapping and lifecycle hooks.
- `src/agent` — pi-mono SDK adapter and agent event normalization.
- `src/extension-host` — TypeScript extension loading/execution boundary.

Do not create a module until it hides meaningful implementation behind a small interface.

## Coding rules

- Prefer deletion and direct code over speculative abstraction.
- Keep state ownership obvious in types and file layout.
- Make invalid lifecycle ordering fail early.
- All queues, retries, timeouts, and concurrency must have explicit bounds.
- Tests should target behavior at module interfaces: eligibility, tick ordering, reconciliation stops, retry scheduling, workspace path safety, and adapter error mapping.
- No generated or build output in commits.

## Verification

For code changes, run from the repo root:

```bash
bun run typecheck
bun run test
```

Add narrower checks as the codebase grows.
