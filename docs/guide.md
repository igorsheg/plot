# Agent guide: build an extension

You are a coding agent asked to automate work with Plot. Your deliverable is a **Workflow Bundle**: a `WORKFLOW.md` and its referenced TypeScript Extension. Plot then runs the loop for you — it discovers work, dispatches an agent per Work Item, retries failures, drains superseded work, and gives the human durable dashboards.

```txt
world -> your extension observes -> Work Items -> Plot schedules -> Agent Runs
             ^                                          |
             +-------- your integration tools <---------+
```

## Read before writing code

Read these fully, in order. `plot docs --paths` prints where they live on disk so you can open them directly; every `plot docs <topic>` command prints to stdout.

1. `plot docs sdk` — the typed contract. Every exported type and field, with semantics in doc comments. This is the authority on the API.
2. `plot docs extensions` — the semantics types cannot express: identity, versions, the five discovery outcomes, tool idempotency, the production checklist.
3. One shipped example, from the `examples` path in `plot docs --paths`:
   - `examples/pr-review/` when the user wants something production-shaped (durable state, guarded writes, operator overrides).
   - `examples/debug/` for a compact tour of every lifecycle hook and `parseConfig`.
4. `plot docs workflows` — the complete `WORKFLOW.md` front-matter reference.

For an embedded, process-owned integration, read `plot docs programmatic`. That path uses a branded Workflow value, a direct Extension value, literal prompt resources, and explicit in-memory credentials. Do not generate a temporary `WORKFLOW.md` or route it through the CLI loader.

## Division of labor — do not blur it

- **Your extension owns facts**: what work exists, its stable `id`, its `version`, whether it is `waiting`/`blocked`/`cancelled`, and idempotent integration writes.
- **Your Workflow prompt owns judgment**: how to investigate, what quality means, when to use which tool.
- **Plot owns control**: scheduling, claims, concurrency, retries with backoff, timeouts, draining, durability, dashboards. If you find yourself writing a queue, a retry loop, or completion bookkeeping, stop — delete it and let discovery state the facts.

## Rules

1. Import Plot symbols only from `plot-ai/sdk`. Everything else (HTTP clients, `node:` builtins, npm packages) is ordinary application code.
2. Return complete, runnable files. No ellipses, no invented APIs.
3. Derive work from the authoritative system every `discover`. Return `[]` only when work is truly done or gone; **throw** (`DiscoveryUnavailableError`) when observation fails.
4. Use stable domain `id`s and revision-based `version`s — never timestamps or randomness.
5. Make every mutation tool idempotent and identity-guarded: bind it to the selected Work Item with a tool factory and re-check domain identity/version before writing.
6. Keep `context` compact facts; put investigation strategy and quality criteria in the Workflow prompt.
7. Put pure decision logic (eligibility, parsing, thresholds) in plain exported functions and write focused tests for them.
8. Do not import Plot internals, build custom dashboard UI, launch nested Agent Sessions, or implement a second scheduler.

## Deliver and verify

Ship this set:

- `WORKFLOW.md` — front matter with `extension.source`, `agent.provider`, and `agent.model`; add scheduling, concurrency, and resource policy deliberately; include a prompt that teaches judgment.
- `<name>.extension.ts` — the extension module, default export.
- Tests for the pure logic you extracted.
- A short README: prerequisites (auth, tokens), how to run, what the operator will see.

Then verify — actually run these, do not just hand them over:

```bash
plot check WORKFLOW.md    # side-effect-free readiness validation
plot WORKFLOW.md          # start or attach the terminal dashboard
plot stop WORKFLOW.md     # explicit shutdown after verification
```

`check` parses the Workflow, loads the Extension, checks Source requirements, and validates the configured provider/model and auth. It never calls `discover()` or invokes requirement actions. Action-required Sources are resolved from the TUI or Web Console after the Session starts.

Also confirm discovery works: run the Workflow and check that the expected Work Items appear, that completing one makes it disappear on the next tick, and that an unreachable backend makes discovery throw rather than report an empty board.

## User goal

<replace this with what the extension should observe and do>
