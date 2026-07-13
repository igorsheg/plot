# Plot

Plot is a control plane for long-running coding-agent work. Reusable trusted TypeScript observes real systems and exposes safe tools; each Workflow supplies integration configuration and agent judgment; Plot owns reconciliation, scheduling, retries, durability, and operator surfaces.

```txt
world -> Extension/Source -> Work Item -> Plot -> Agent Run
                                       |
                                       +-> Session History and dashboards
```

## Core model

- An **Extension** implements reusable integration behavior.
- A **Workflow** configures an Extension for one use: system, prompt, model, and runtime policy.
- A **Plot Session** is the durable execution of one Workflow.
- A Workflow has at most one Active Plot Session.
- The same Extension can back many concurrent Workflows.

For example, two repository-specific PR-review Workflows can share one PR-review Extension while using different repository configuration and prompts.

## Start

```bash
npm install -g plot-ai
plot auth login
plot check WORKFLOW.md
plot WORKFLOW.md
```

`plot WORKFLOW.md` starts or attaches to its Session and opens the terminal dashboard. `q` or Ctrl-C confirms before stopping; `d` explicitly detaches and leaves the Session running.

```bash
plot start WORKFLOW.md    # start without attaching
plot stop WORKFLOW.md     # explicit shutdown
plot web                  # Fleet Web Console
```

## Workflow

```md
---
name: review-acme-prs
agent:
  provider: openai-codex
  model: gpt-5.5
  maxTurns: 4
extension:
  source: ./github-pr-reviewer.extension.ts
  maxConcurrentRuns: 2
  config:
    repository: acme/web
plot:
  tickIntervalMs: 300000
---

# Review {{ work.title }}

Inspect the diff and callers, run relevant checks, and post a review only after verification.
```

A Workflow must reference an Extension. Plot has one continuous, Source-driven scheduler mode.

## Extension

```ts
import { definePlotExtension } from "plot-ai/sdk";

export default definePlotExtension({
	id: "github-pr-reviewer",
	create: ({ config, work }) => ({
		async discover() {
			const prs = await listOpenPullRequests(config.repository);
			return prs.map((pr) =>
				work({
					id: `github:pr:${pr.number}`,
					version: pr.headSha,
					title: pr.title,
					context: { repository: config.repository, prNumber: pr.number },
				}),
			);
		},
	}),
});
```

Production discovery must throw on observation failure. Returning `[]` authoritatively means previously known work is gone.

## Documentation

```bash
plot docs quickstart
plot docs guide
plot docs workflows
plot docs extensions
plot docs sdk
plot docs --paths
```

[Quickstart](docs/quickstart.md) · [Workflows](docs/workflows.md) · [Extensions](docs/extensions.md) · [CLI](docs/cli.md) · [TUI](docs/tui.md) · [Web Console](docs/web.md)

## Development and release

```bash
bun install
bun run check
bun run release:local --version 0.0.0-test --skip-check
```

Releases are tag-driven from `v*`.
