# Plot

Plot is a control plane for coding-agent work. Trusted TypeScript observes real systems and exposes safe tools; Markdown teaches agent judgment; Plot owns scheduling, retries, durability, and operator surfaces.

```bash
npx plot-ai --help
```

## Mental model

```txt
world -> extension/Source -> versioned Work Item -> Plot -> Agent Run
              |                                      |
              +----------- registered tools --------+

Plot: tick -> reconcile facts -> act
```

- The extension owns authoritative facts, stable identity/revision, integration correctness, and idempotent side effects.
- The Workflow prompt owns investigation strategy and quality criteria.
- Plot owns claims, concurrency, draining, continuation, exponential retry, timeout/stall handling, shutdown, RuntimeEvents, and managed processes.
- Dashboards reduce canonical events; they do not become another source of runtime truth.

## One-shot work

```bash
npm install -g plot-ai
plot init
plot auth login
plot open WORKFLOW.md
```

A Workflow without an extension creates one synthetic Work Item and runs once.

## Continuous discovered work

`WORKFLOW.md`:

```md
---
name: review-open-prs
agent: { provider: openai-codex, model: gpt-5.5, maxTurns: 4 }
extension: { source: ./github-pr-reviewer.extension.ts, maxConcurrentRuns: 2 }
plot: { tickIntervalMs: 300000, maxRunDurationMs: 900000 }
---

# Review {{ work.title }}

Inspect the diff and callers, run relevant checks, and use `post_review` only after verification.
```

`github-pr-reviewer.extension.ts`:

```ts
import { definePlotExtension } from "plot-ai/sdk";

export default definePlotExtension({
	id: "github-pr-reviewer",
	create: ({ work }) => ({
		async discover() {
			const prs = await listOpenPullRequests();
			return prs.map((pr) =>
				work({
					id: `github:pr:${pr.number}`,
					version: pr.headSha,
					title: pr.title,
					url: pr.url,
					context: { prNumber: pr.number, repository: pr.repository },
				}),
			);
		},
	}),
});
```

The API call above is application code. Production discovery must throw on observation failure; returning `[]` authoritatively means all previously known work is gone.

## Scheduling semantics

| Source observation   | Plot behavior                                           |
| -------------------- | ------------------------------------------------------- |
| `pending` or omitted | Eligible for dispatch.                                  |
| `waiting`            | Keep claim visible; wait for the external world.        |
| `blocked`            | Keep claim visible; wait for a human decision.          |
| `cancelled`          | Interrupt active work and release immediately.          |
| Item absent          | Drain an active turn, then release without redispatch.  |
| Same id, new version | Drain old revision before dispatching replacement.      |
| Run fails/times out  | Retry with exponential backoff, capped at five minutes. |
| Run becomes inactive | Optional stall timeout interrupts it.                   |

## Operator surfaces

```bash
plot open WORKFLOW.md          # live terminal dashboard
plot open WORKFLOW.md --web    # durable browser projection + HTTP/SSE
plot run WORKFLOW.md           # no dashboard
plot runs                      # managed-run catalog
plot events stream <run-id>    # durable replay then live JSONL
plot api schema                # exact Session protocol methods
```

The TUI starts and watches one live run. The web gateway can reconstruct durable projections and continue gaplessly from Session RuntimeEvent JSONL.

## Authoring references

```bash
plot docs quickstart
plot docs workflows
plot docs extensions
plot docs cli
plot docs web
plot docs extension-prompt | pbcopy
```

[Quickstart](docs/quickstart.md) · [Workflows](docs/workflows.md) · [Extensions](docs/extensions.md) · [CLI](docs/cli.md) · [TUI](docs/tui.md) · [Web/API](docs/web.md)

## Development and release

```bash
bun install
bun run check
bun run release:local --version 0.0.0-test --skip-check
```

Releases are tag-driven from `v*`.
