# Plot PR Review example

A standalone GitHub PR review workflow for Plot.

This example intentionally keeps orchestration thin:

- `github-pr-reviewer.extension.ts` discovers the current PR and skips already-reviewed heads.
- `WORKFLOW.md` gives the agent review posture, project invariants, and posting instructions.
- `skills/pr-review` provides reusable review know-how: architecture exploration, behavioral path review, test analysis, stacked PRs, and multi-PR review.

The agent is expected to use normal tools (`bash`, `git`, `gh`, `rg`, tests) and post with `gh pr review` directly.

## Use

Copy or reference this directory from a repository with Plot installed, then run the workflow from that repository root.

```bash
plot run --workflow examples/pr-review/WORKFLOW.md
```

The workflow expects GitHub CLI authentication and a current branch with an associated pull request.
