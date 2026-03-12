---
name: plot-github-tracker
description: "github issue state management for plot orchestration. state transitions via labels, workpad comment lifecycle, and issue/PR linkage. use when moving issues between states, creating/updating workpad comments, or linking PRs to issues."
---

# plot-github-tracker

manages issue state and progress tracking for the plot orchestrator via GitHub labels and comments.

use `gh` CLI for all GitHub operations. `$GITHUB_REPO` must be set to `owner/repo`.

## state transitions

issue state is determined by labels. plot only routes issues that have an explicit `plot:*` state label. unlabeled issues are ignored.

transition by removing the previous `plot:*` label and adding the new one:

```bash
# todo -> in-progress
gh issue edit <number>   --repo "$GITHUB_REPO"   --remove-label "plot:todo"   --add-label "plot:in-progress"

# in-progress -> human-review
gh issue edit <number>   --repo "$GITHUB_REPO"   --remove-label "plot:in-progress"   --add-label "plot:human-review"

# rework -> human-review
gh issue edit <number>   --repo "$GITHUB_REPO"   --remove-label "plot:rework"   --add-label "plot:human-review"

# merging -> done, then close
gh issue edit <number>   --repo "$GITHUB_REPO"   --remove-label "plot:merging"   --add-label "plot:done"
gh issue close <number> --repo "$GITHUB_REPO"
```

if you need to move a terminal issue back into active work, reopen first, then swap labels:

```bash
gh issue reopen <number> --repo "$GITHUB_REPO"
gh issue edit <number>   --repo "$GITHUB_REPO"   --remove-label "plot:done"   --add-label "plot:rework"
```

## available states

| label             | meaning                    | agent action                                           |
| ----------------- | -------------------------- | ------------------------------------------------------ |
| plot:todo         | queued for work            | move to plot:in-progress, start execution              |
| plot:in-progress  | implementation underway    | implement, verify, open PR, move to plot:human-review |
| plot:human-review | PR open, waiting on human  | do nothing, wait                                       |
| plot:rework       | reviewer requested changes | read feedback, fix, move to plot:human-review         |
| plot:merging      | human approved             | merge PR, move to plot:done                           |
| plot:done         | terminal                   | stop                                                   |

## workpad comment

a single persistent GitHub issue comment used as a living scratchpad across agent sessions.

### find or create

```bash
# search for existing workpad
gh api repos/$GITHUB_REPO/issues/<number>/comments --jq '.[] | select(.body | startswith("## Plot Workpad")) | .id' | head -1
```

if not found, create it:

```bash
gh api repos/$GITHUB_REPO/issues/<number>/comments   -X POST   -f body='## Plot Workpad

### Plan

- [ ] 1. <task>

### Acceptance Criteria

- [ ] <criterion>

### Validation

- [ ] <test command>

### Latest Attempt Summary

- changed: <files or none>
- validated: <commands + outcome>
- failed: <remaining failure or none>
- blocked: <blocker or none>

### Notes

- <durable context>'
```

### update existing

replace the full workpad body in place:

```bash
gh api repos/$GITHUB_REPO/issues/comments/<id>   -X PATCH   -f body='...full updated workpad body...'
```

### rules

- exactly one workpad comment per issue, identified by `## Plot Workpad` header
- reuse existing comment on continuation runs — do not create duplicates
- update the workpad after every meaningful milestone
- never leave completed items unchecked
- include workspace id and short sha at top: `<workspace-id>@<short-sha>`

## workpad template

````markdown
## Plot Workpad

```text
<workspace-id>@<short-sha>
```

### Plan

- [ ] 1. Parent task
  - [ ] 1.1 Child task
- [ ] 2. Parent task

### Acceptance Criteria

- [ ] Criterion 1
- [ ] Criterion 2

### Validation

- [ ] targeted tests: `<command>`

### Latest Attempt Summary

- changed: <files or none>
- validated: <commands + outcome>
- failed: <remaining failure or none>
- blocked: <blocker or none>

### Notes

- <short durable context>

````

## issue queries

```bash
# view issue details
gh issue view <number> --repo "$GITHUB_REPO" --json title,body,state,labels,comments

# list open issues by label
gh issue list --repo "$GITHUB_REPO" --label "plot:in-progress" --state open
```

## PR linkage

after creating or updating a PR, ensure the PR body includes `Resolves #<number>`. that is the durable issue/PR link.

if you need to post the PR URL back to the issue, add a normal issue comment:

```bash
gh api repos/$GITHUB_REPO/issues/<number>/comments   -X POST   -f body='linked PR: <pr-url>'
```
