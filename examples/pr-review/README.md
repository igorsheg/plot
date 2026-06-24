# Plot PR Review example

A standalone GitHub PR review workflow for Plot.

This example keeps Cloudflare-style review discipline but removes Cloudflare-style nested orchestration:

- `github-pr-reviewer.extension.ts` is a generic GitHub Source. It discovers open PRs, parses the one Plot anchor comment, and returns one Work Item per PR head that still needs review.
- The extension exposes only two write tools: `upsert_review_anchor` and `post_pr_review`. They check the head SHA and perform idempotent GitHub mutations.
- The Agent Run owns the review: clone/fetch, read code, run searches/tests, apply review lenses, synthesize findings, and post one review.
- Durable state lives on the PR in one anchor comment. A crashed run leaves `status=reviewing`; the next Plot tick reconciles GitHub truth and the source can select it again.
- There are no source-launched subagents and no prompt-owned phase machine.

## Use

Install Plot via the `plot-ai` package, then install this example's extension dependency. The example imports the public SDK from `plot-ai/sdk`, just like a real external extension.

```bash
npm install -g plot-ai
npm install --prefix examples/pr-review
plot run --workflow examples/pr-review/WORKFLOW.md
```

For the dashboard:

```bash
plot tui --workflow examples/pr-review/WORKFLOW.md
```

The workflow expects GitHub CLI authentication and a repository with open pull requests. Review progress is durable in the PR anchor comment, so the source can select unfinished work without local state.

## Project shape

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
