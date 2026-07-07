# Plot

Run coding agents against real work, continuously, without babysitting them.

```bash
npm install -g plot-ai
plot --workflow WORKFLOW.md
```

## The problem

You have an agent that can review a PR, triage a failing build, investigate a
production error.

Now run it against every PR. All day. While you do something else.

Suddenly you're writing the boring parts: a poll loop, a job queue, retry
backoff, "is that run still alive?", a dashboard, cleanup for the run that died
mid-write. None of that is agent judgment. All of it is scheduling.

Plot is the scheduling. You keep the judgment.

## The mental model

Three layers. Each stays out of the other two.

```txt
your extension finds work     trusted TypeScript that reads GitHub, CI, Sentry, a queue
Plot schedules Agent Runs     tick -> reconcile -> act
your prompt teaches judgment  Markdown that says what good work looks like
```

The extension never runs agents. The prompt never schedules. Plot doesn't know
your domain — it tracks whether work is pending, running, blocked, failed, or
done.

## What you write

A Workflow is one Markdown file:

```md
---
name: review-open-prs
extension: { source: ./github-pr-reviewer.extension.ts }
agent: { provider: openai-codex, model: gpt-5.5 }
resources: { contextFiles: true }
---

# Review {{ work.title }}

Use the repository, tests, and judgment. Post one useful review.
```

An extension is one TypeScript file:

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
					version: pr.headSha, // new head = new work, automatically
					title: pr.title,
					context: { prNumber: pr.number },
				}),
			);
		},
	}),
});
```

Return the work that exists. Stop returning work that's done. Reruns,
deduplication, and cleanup fall out of `id` + `version`.

## What you don't write

| When this happens                   | What Plot does                                                                          |
| ----------------------------------- | --------------------------------------------------------------------------------------- |
| The process dies mid-run            | State reconstructs from your systems on the next tick — there is no database to corrupt |
| Work disappears while a run is live | The run drains: finishes its turn, never killed for succeeding                          |
| A run fails repeatedly              | Exponential backoff, visible as a scheduled wake on the dashboard                       |
| A run goes silent                   | Stall timeout interrupts it                                                             |
| Twenty items appear at once         | Global and per-source concurrency caps                                                  |
| A human wants in                    | Operator Actions your extension declares become buttons in the TUI and web              |

## Try the PR reviewer

```bash
plot --workflow examples/pr-review/WORKFLOW.md
```

Tiered review depth, re-review on push, a quiet period for rapid pushes,
bot/label/draft gating. One anchor comment per PR holds all review state.

Needs an authenticated `gh` and provider auth (`plot auth login`).

## Try the debug lab

```bash
plot --workflow examples/debug/WORKFLOW.md
```

Synthetic long-running work for inspecting every Plot state in the TUI and web dashboard: queued, running, waiting, blocked, draining, failed, interrupted, timed out, operator actions, custom tools, and retry wakes.

## Watch it work

```bash
plot --workflow WORKFLOW.md   # TUI dashboard
plot web                      # same session, in the browser
plot api --stdio              # same session, as JSONL for machines
```

## Write your extension with an agent

```bash
plot docs extension-prompt | pbcopy
```

Paste it into your coding agent and describe your source of work.

## Docs and development

[Quickstart](docs/quickstart.md) · [Workflows](docs/workflows.md) ·
[Extensions](docs/extensions.md) · [TUI](docs/tui.md) · [Web](docs/web.md)

```bash
bun install
bun run check
```

Releases are tag-driven from `v*`. Run
`bun run release:local --version <version>` before cutting one.
