# Plot PR Review example

A standalone GitHub PR review workflow for Plot.

This example intentionally keeps orchestration to a bare minimum — the LLM is the capable part:

- `github-pr-reviewer.extension.ts` is a pure reader. It discovers the current PR, parses the anchor comment's marker (`<!-- plot-review:v1 status=... head=... tier=... -->`), and tells Plot whether work exists and at which phase. It registers no tools and performs no writes.
- All durable review state lives on the PR itself, in one anchor comment the agent maintains. There is no local state; a crashed tick loses nothing.
- Each Plot tick runs one bounded review phase. The agent reads the anchor with `gh`, wears the phase's hat, appends findings to the anchor, and advances the marker status. The `post` phase publishes one GitHub review with inline threads and flips the marker to `done`.
- `WORKFLOW.md` is the product: risk tiering, phase hats with what-NOT-to-flag boundaries, the synthesize/judge pass, the GitHub review event rubric, re-review semantics, and prompt-injection rules all live in its body as prompt engineering.
- `skills/pr-review` provides reusable review know-how: architecture exploration, behavioral path review, test analysis, GitHub review API recipes, stacked PRs, and multi-PR review.

The review agent uses normal tools (`bash`, `git`, `gh`, `rg`, tests) for everything, including all GitHub mutation. Its writes are constrained by prompt contract to the current PR's anchor comment and reviews.

## Use

Install Plot via the `plot-ai` package, then install this example's extension dependency. The example imports the public SDK from `plot-ai/sdk`, just like a real external extension.

```bash
npm install -g plot-ai
npm install --prefix examples/pr-review
plot run --workflow examples/pr-review/WORKFLOW.md
```

For the dashboard/control plane:

```bash
plot tui --workflow examples/pr-review/WORKFLOW.md
```

The workflow expects GitHub CLI authentication and a current branch with an associated pull request. Review progress is durable in the PR anchor comment, so the outer Plot loop can retry or continue phases without nested agent orchestration.

## Project shape

This example is intentionally self-contained:

```txt
examples/pr-review/
  WORKFLOW.md
  github-pr-reviewer.extension.ts
  skills/pr-review/
```

`WORKFLOW.md` explicitly declares its skill resources. Plot does not auto-load skills from `.plot/agent/skills`; `.plot/` is runtime/state territory, while workflow resources are the versioned behavior contract.

## Review output

Findings should use priority badges with raw Shields.io URLs, not GitHub Camo URLs:

```md
**<sub><sub>![P0 Badge](https://img.shields.io/badge/P0-red?style=flat)</sub></sub> P0 title**
**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub> P1 title**
**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub> P2 title**
```
