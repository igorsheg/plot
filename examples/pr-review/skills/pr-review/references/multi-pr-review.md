# Multi-PR Review

When asked to review multiple PRs, isolate each PR and synthesize results.

## Worktree isolation

Use separate worktrees so files, generated artifacts, and test output do not collide:

```bash
BRANCH=$(gh pr view <PR_NUMBER> --json headRefName -q '.headRefName')
WORKTREE_DIR="/tmp/pr-review-<PR_NUMBER>"
git fetch origin "$BRANCH"
git worktree add "$WORKTREE_DIR" "origin/$BRANCH" --detach
```

Clean up when done:

```bash
git worktree remove "$WORKTREE_DIR" --force
git worktree prune
```

## Process

1. Create worktrees.
2. Group PRs by risk/domain/package.
3. Review independently.
4. Compare related PRs for ordering or shared assumptions.
5. Post one review per PR.
6. Clean up worktrees.

## Synthesis

For batch summaries:

```md
| PR   | Risk | Verdict          | Main reason                    |
| ---- | ---- | ---------------- | ------------------------------ |
| #123 | HIGH | BLOCKING_COMMENT | protocol response ordering bug |
```
