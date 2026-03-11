---
name: plot-github-tracker
description: "github issue state management for plot orchestration. state transitions via labels, workpad comment lifecycle, issue/PR linkage. use when moving issues between states, creating/updating workpad comments, or linking PRs to issues."
---

# plot-github-tracker

manages issue state and progress tracking for the plot orchestrator via GitHub labels and comments.

read-only operations still use `gh` directly: viewing issues, listing issues, inspecting PRs, and similar reads.

## state transitions

issue state is determined by labels. plot only routes issues that have an explicit `plot:*` state label. unlabeled issues are ignored.

to transition, use `github_transition_issue`:

- move to `plot:in-progress` from `plot:todo`
- move to `plot:human-review` from `plot:in-progress`
- move to `plot:human-review` from `plot:rework`
- move to `plot:done` from `plot:merging` and close the issue

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
```

if not found, use `github_add_comment` with this body:

```markdown
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
```

### update existing

use `github_update_comment` to replace the workpad comment body.

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
gh issue view <number> --repo $GITHUB_REPO --json title,body,state,labels,comments

# list open issues by label
gh issue list --repo $GITHUB_REPO --label "plot:in-progress" --state open
```

## PR linkage

after creating a PR, use `github_link_pull_request` to link the PR to the issue. the PR body should still reference the issue with `Resolves #<number>`.
