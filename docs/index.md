# Plot

Plot is a control plane for coding-agent work. Trusted TypeScript observes the world and defines safe integration tools; a Markdown Workflow teaches the agent how to investigate and decide; Plot owns scheduling, Agent Runs, durability, retries, and operator surfaces.

```txt
world -> Source/extension -> Work Item -> Plot scheduler -> Agent Run
              ^                    |              |
              |                    |              v
         integration tools <-------+       durable RuntimeEvents
```

## Two ways to run

### One-shot Workflow

A Workflow without an `extension` creates one synthetic Work Item, runs the prompt, and stops after it completes. Use this for a single project task.

```bash
plot init
plot open WORKFLOW.md
# or: plot run WORKFLOW.md
```

### Source-driven Workflow

A Workflow with an `extension` repeatedly calls trusted TypeScript `discover()`. Each discovered item becomes versioned work. Use this for PR review, issue queues, CI failures, release operations, or any changing external system.

```yaml
extension:
  source: ./queue.extension.ts
  maxConcurrentRuns: 2
```

## Ownership boundaries

- **Extension/Source owns facts:** what exists, stable identity, revision, waiting/blocked/cancelled state, integration correctness, and idempotent side effects.
- **Workflow prompt owns judgment:** how the agent investigates, what quality means, and when it should use registered tools.
- **Plot owns control:** `tick -> reconcile -> act`, claims, concurrency, continuation, retry backoff, timeout/stall handling, shutdown, event ordering, and process lifecycle.
- **Agent Session owns execution strategy:** reasoning, built-in tools, registered tools, and conversation state within an Agent Run.
- **RuntimeEvents own replay:** dashboards and API projections reduce canonical events rather than reading scheduler internals.

Extensions are trusted TypeScript, not sandboxed plugins. Import only the public SDK:

```ts
import { definePlotExtension, defineTool } from "plot-ai/sdk";
```

## Documentation map

- [Quickstart](quickstart.md) — install, authenticate, and run one-shot or source-driven work.
- [Workflows](workflows.md) — complete front-matter and prompt contract.
- [Extensions](extensions.md) — complete SDK, Work Item, discovery, tool, hook, and operator-action contract.
- [CLI](cli.md) — commands, flags, JSON/JSONL behavior, and session protocol.
- [TUI](tui.md) — live terminal control room and keys.
- [Web](web.md) — durable browser projection, HTTP routes, and SSE continuation.

For an LLM-ready extension authoring brief:

```bash
plot docs extension-prompt
```
