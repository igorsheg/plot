---
name: plot-github-tracker
description: "github issue state management for plot orchestration. state transitions via labels, workpad comment lifecycle, issue/PR linkage. use when moving issues between states, creating/updating workpad comments, or linking PRs to issues."
---

# plot-github-tracker

manages issue state and progress tracking for the plot orchestrator via GitHub labels and comments.

## state transitions

issue state is determined by labels. plot only routes issues that have an explicit `plot:*` state label. unlabeled issues are ignored.

to transition, swap labels:

```bash
# move to plot:in-progress
gh issue edit <number> --add-label "plot:in-progress" --remove-label "plot:todo" --repo $GITHUB_REPO

# move to plot:human-review
gh issue edit <number> --add-label "plot:human-review" --remove-label "plot:in-progress" --repo $GITHUB_REPO
gh issue edit <number> --add-label "plot:human-review" --remove-label "plot:rework" --repo $GITHUB_REPO

# move to plot:done (terminal)
gh issue edit <number> --add-label "plot:done" --remove-label "plot:merging" --repo $GITHUB_REPO
gh issue close <number> --repo $GITHUB_REPO
```

always remove the previous `plot:*` state label when adding the new one.

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

# create if not found
gh issue comment <number> --repo $GITHUB_REPO --body "$(cat <<'EOF'
## Plot Workpad

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

- <durable context>
EOF
)"
```

### update existing

```bash
gh api repos/$GITHUB_REPO/issues/comments/<comment-id> \
  -X PATCH -f body="<updated markdown body>"
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
````

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
gh issue view <number> --repo $GITHUB_REPO --json title,body,state,labels,comments

# list open issues by label
gh issue list --repo $GITHUB_REPO --label "plot:in-progress" --state open
````

## PR linkage

after creating a PR, the PR body should reference the issue with `Resolves #<number>`. no additional linkage commands needed — GitHub handles it automatically.
