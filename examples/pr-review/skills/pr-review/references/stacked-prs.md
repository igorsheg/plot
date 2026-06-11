# Stacked PRs

A PR is stacked when its base branch is not the repository's main branch.

## Detect

```bash
gh pr view <number> --json baseRefName,headRefName
```

If `baseRefName` is not the main branch, inspect the chain before judging the PR in isolation.

## Review approach

1. Identify the stack order.
2. Review only the delta introduced by the current PR when possible.
3. Check whether dependencies on earlier PRs are intentional.
4. Do not flag missing code that exists in an earlier stack layer.
5. Do flag fragile stack coupling, broken intermediate states, or changes that only work when merged in an undocumented order.

Useful commands:

```bash
gh pr view <number> --json baseRefName,headRefName,commits,files
git diff origin/<baseRefName>...HEAD
gh pr list --head <branch> --json number,title,baseRefName,headRefName
```
