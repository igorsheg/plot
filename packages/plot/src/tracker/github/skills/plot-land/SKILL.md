---
name: plot-land
description: "merge an approved PR for plot. monitors CI, resolves conflicts, handles review feedback, squash-merges, and transitions issue to plot:done. use when issue enters plot:merging state."
---

# plot-land

## goals

- ensure PR is conflict-free with main
- address any outstanding review feedback
- squash-merge the PR when checks pass
- transition issue to plot:done and close it

## preconditions

- `gh` CLI is authenticated
- issue is in `plot:merging` state (label)
- a PR exists for the current branch

## steps

1. locate the PR:

   ```bash
   branch=$(git branch --show-current)
   pr_number=$(gh pr view --json number -q .number --repo $GITHUB_REPO)
   ```

2. run the review feedback sweep before merging:

   ```bash
   # top-level PR comments
   gh pr view $pr_number --repo $GITHUB_REPO --comments

   # inline review comments (line-level)
   gh api repos/$GITHUB_REPO/pulls/$pr_number/comments

   # review summaries
   gh pr view $pr_number --repo $GITHUB_REPO --json reviews
   ```

   for each actionable comment:
   - **accept**: implement fix, commit, push
   - **push back**: reply with justification
   - **clarify**: ask for specifics

   do not merge while review comments are outstanding.

3. check mergeability:

   ```bash
   mergeable=$(gh pr view --json mergeable -q .mergeable --repo $GITHUB_REPO)
   ```

   if `CONFLICTING`:
   - use the `plot-pull-main` skill to merge origin/main and resolve conflicts
   - use the `plot-push-pr` skill to push the updated branch

   if `UNKNOWN`:
   - wait and re-check

4. run local verification:

   ```bash
   bun run typecheck
   bun run lint
   ```

5. watch CI checks:

   ```bash
   gh pr checks $pr_number --repo $GITHUB_REPO --watch
   ```

   if checks fail:
   - inspect logs: `gh run view <run-id> --log`
   - fix locally, commit with `plot-commit`, push with `plot-push-pr`
   - re-run check watch

   use judgment for flaky failures (timeouts on one platform) — may proceed.

6. squash-merge:

   ```bash
   pr_title=$(gh pr view --json title -q .title --repo $GITHUB_REPO)
   gh pr merge $pr_number --squash --subject "$pr_title" --repo $GITHUB_REPO
   ```

7. transition issue to plot:done:
   ```bash
   # extract issue number from PR body (Resolves #N)
   issue_number=<extracted>
   gh issue edit $issue_number --add-label "plot:done" --remove-label "plot:merging" --repo $GITHUB_REPO
   gh issue close $issue_number --repo $GITHUB_REPO
   ```

## review response format

when responding to feedback on the PR:

```
[plot] <response — what you're doing about this comment>
```

prefix all agent-generated PR comments with `[plot]`.

## rules

- never call `gh pr merge` without completing the review sweep first
- only use `--force-with-lease` if history was rewritten; prefer normal push
- do not enable auto-merge — run the full watch loop
- address correctness feedback with concrete validation before closing it
- after pushing fixes, post a summary comment:
  ```
  [plot] Changes since last review:
  - <bullets>
  Commits: <sha>
  Validation: <commands run>
  ```
