# Plot

Plot is a control plane for coding-agent work. You describe _what work exists_ in trusted TypeScript and _how to handle it_ in a Markdown prompt; Plot runs the loop — discovery, scheduling, one Agent Run per Work Item, retries, draining, durable history, and live dashboards for the human in charge.

```txt
world -> Source/extension -> Work Item -> Plot scheduler -> Agent Run
              ^                    |              |
              |                    |              v
         integration tools <-------+       durable RuntimeEvents
```

> Plot's docs are written for coding agents as much as for people. To build an integration, point your agent at `npx plot-ai docs guide` and describe your use case.

## Two ways to run

**One-shot**: a `WORKFLOW.md` without an `extension` runs its prompt once as a single synthetic Work Item and stops.

```bash
plot init
plot open WORKFLOW.md
```

**Source-driven**: a Workflow with an `extension` repeatedly discovers versioned Work Items from a changing system — every open PR, every failing CI job, every queued ticket.

```yaml
extension:
  source: ./queue.extension.ts
  maxConcurrentRuns: 2
```

## Ownership boundaries

- **Extension owns facts** — what exists, stable identity, revision, held/blocked state, idempotent integration writes.
- **Workflow prompt owns judgment** — how the agent investigates, what quality means, when to use which tool.
- **Plot owns control** — `tick -> reconcile -> act`, claims, concurrency, retry backoff, timeouts, shutdown, event ordering.
- **Agent Session owns execution** — reasoning, built-in tools, registered tools, conversation state.

Extensions are trusted TypeScript, not sandboxed plugins, and import Plot symbols only from `plot-ai/sdk`.

## Documentation map

| Read                        | When                                                                                |
| --------------------------- | ----------------------------------------------------------------------------------- |
| [Quickstart](quickstart.md) | Install, authenticate, run your first Workflow.                                     |
| [Agent guide](guide.md)     | You are (or are driving) a coding agent that should build an extension. Start here. |
| [Extensions](extensions.md) | Semantics of discovery, identity, versions, tools, operator actions.                |
| [Workflows](workflows.md)   | Complete `WORKFLOW.md` front-matter reference.                                      |
| [CLI](cli.md)               | Commands, flags, JSON/JSONL behavior, session protocol.                             |
| [TUI](tui.md)               | The live terminal control room.                                                     |
| [Web](web.md)               | Browser dashboard, HTTP routes, SSE continuation.                                   |

The typed extension contract is not a markdown page at all: `plot docs sdk` prints the SDK's TypeScript declarations, and `plot docs --paths` prints where docs, examples, and declarations live on disk. Complete working extensions ship with the package under `examples/`.
