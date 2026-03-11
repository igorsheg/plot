---
name: plot-push-pr
description: "push branch and create/update pull request for plot. handles PR creation, template compliance, title/body maintenance, and closed PR detection. use when publishing changes and opening or updating a PR."
---

# plot-push-pr

## goals

- push current branch to origin safely
- create or update a PR with template-compliant body
- detect and handle closed/merged PR branches

## steps

1. identify current branch and confirm it's not `main`:

   ```bash
   branch=$(git branch --show-current)
   if [ "$branch" = "main" ]; then echo "ERROR: do not push directly to main"; exit 1; fi
   ```

2. run validation before pushing:

   ```bash
   bun run typecheck
   bun run lint
   ```

3. push branch to origin:

   ```bash
   git push -u origin HEAD
   ```

   if push is rejected (non-fast-forward), sync first:

   ```bash
   git fetch origin
   git merge origin/main
   git push -u origin HEAD
   ```

4. check if a PR already exists for this branch:

   ```bash
   pr_state=$(gh pr view --json state -q .state --repo $GITHUB_REPO 2>/dev/null || echo "NONE")
   ```

5. handle PR state:
   - `NONE` → create new PR
   - `OPEN` → update existing PR
   - `MERGED` or `CLOSED` → branch is stale; create a new branch and PR

6. create PR with template compliance:

   ```bash
   gh pr create \
     --title "<issue-id>: <clear description of change>" \
     --body-file /tmp/pr-body.md \
     --repo $GITHUB_REPO
   ```

   after creation:
   - call `github_link_pull_request` to link the PR to the issue
   - call `github_transition_issue` to move the issue from its current state to `plot:human-review`

7. update existing PR if scope changed:
   ```bash
   gh pr edit --title "<updated title>" --body-file /tmp/pr-body.md --repo $GITHUB_REPO
   ```

   after update:
   - call `github_link_pull_request` to link the PR to the issue

## PR body template

the PR body must follow `.github/pull_request_template.md`. fill every section:

```markdown
## Summary

<what this PR does — 1-2 sentences>

## Changes

- <key change 1>
- <key change 2>

## Verification

- [x] Typecheck passes (`bun run typecheck`)
- [x] Lint passes (`bun run lint`)
- <additional verification done>

## Issue

Resolves #<number>
```

## rules

- never force push (`--force` or `-f`)
- `--force-with-lease` only when history was rewritten (rebase)
- PR title format: `#<number>: <short description>`
- PR body must have all template sections filled — no placeholder comments
- on branch updates, reconsider whether PR title still matches scope
- return PR URL after creation/update
