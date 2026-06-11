# Plot PR Review example

A standalone GitHub PR review workflow for Plot.

This example intentionally keeps orchestration thin:

- `github-pr-reviewer.extension.ts` discovers the current PR and skips already-reviewed heads.
- The extension registers pi-native tools: prepare context, assess risk, load/advance durable review state, and post the final GitHub review.
- Each Plot tick runs one bounded agent phase. The agent writes durable XML to `.plot/review/pr-<number>/` and advances `state.json`; interrupted phases are resumed by the next tick.
- `WORKFLOW.md` lays out all review hats and tells the single agent how to behave for each durable status.
- `skills/pr-review` provides reusable review know-how: architecture exploration, behavioral path review, test analysis, stacked PRs, and multi-PR review.

The review agent is expected to use normal tools (`bash`, `git`, `gh`, `rg`, tests), complete only the current durable phase, synthesize from prior XML artifacts when the state reaches `synthesize`, and use the registered posting tool for GitHub mutation when the state reaches `post`.

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

The workflow expects GitHub CLI authentication and a current branch with an associated pull request. Review progress is durable in `.plot/review/pr-<number>/state.json`, so the outer Plot loop can retry or continue phases without nested subagent orchestration.

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
![P0](https://img.shields.io/badge/P0-red?style=flat)
![P1](https://img.shields.io/badge/P1-orange?style=flat)
![P2](https://img.shields.io/badge/P2-yellow?style=flat)
```
