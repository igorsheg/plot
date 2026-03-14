---
name: plot-beads-tracker
description: "beads issue state management for plot orchestration. state transitions via bd set-state, workpad comment lifecycle, and issue queries. use when moving issues between states, creating/updating workpad comments, or querying issue status."
---

# plot-beads-tracker

manages issue state and progress tracking for the plot orchestrator via `bd` status, `plot:*` state dimensions, and comments.

use `bd` for all tracker operations. do not use `gh`. beads issues are local and have no url.

## state model

beads has two separate state layers:

- issue `status` tracks actual work state: `open`, `in_progress`, `blocked`, `deferred`, `closed`
- `plot:*` state tracks orchestrator routing via `bd set-state <id> plot=<value>`

plot routes by `plot` state, not by status alone. keep both layers coherent.

- when starting active work, issue status should usually be `in_progress`
- when work is queued but not started, issue status is usually `open`
- when work is complete, set `plot=done` then close the issue

## state transitions

use `bd set-state` for plot routing changes. use `bd update`, `bd close`, and `bd reopen` for underlying issue lifecycle.

```bash
# todo -> in-progress
bd update <id> --status in_progress
bd set-state <id> plot=in-progress --reason "starting work"

# in-progress -> human-review
bd set-state <id> plot=human-review --reason "PR ready for review"

# rework -> human-review
bd set-state <id> plot=human-review --reason "rework complete"

# merging -> done, then close
bd set-state <id> plot=done --reason "PR merged"
bd close <id> -r "completed"

# reopen terminal -> rework
bd reopen <id> -r "needs rework"
bd set-state <id> plot=rework --reason "reopened for changes"
bd update <id> --status in_progress
```

if you need to park work without changing plot routing, update the issue status directly:

```bash
bd update <id> --status blocked
bd update <id> --status deferred
bd update <id> --status open
bd update <id> --status in_progress
```

## available states

| layer | state | meaning | agent action |
| --- | --- | --- | --- |
| plot | `plot:todo` | queued for execution | set issue to `in_progress`, move to `plot:in-progress`, start work |
| plot | `plot:in-progress` | implementation underway | implement, verify, push PR, move to `plot:human-review` |
| plot | `plot:human-review` | waiting on human review | do nothing, wait |
| plot | `plot:rework` | changes requested | address feedback, then move to `plot:human-review` |
| plot | `plot:merging` | approved, ready to land | finish merge flow, move to `plot:done`, close issue |
| plot | `plot:done` | terminal plot state | stop |
| issue status | `open` | not started or re-opened queue state | eligible for `bd ready --json` if unblocked |
| issue status | `in_progress` | active work underway | keep aligned with active execution |
| issue status | `blocked` | blocked by dependency or external condition | record blocker in workpad |
| issue status | `deferred` | intentionally postponed | stop unless explicitly resumed |
| issue status | `closed` | terminal issue state | stop |

workflow routing states:

- dispatch_states: `plot:todo`, `plot:in-progress`, `plot:rework`, `plot:merging`
- parked_states: `plot:human-review`
- terminal_states: `plot:done`, `closed`

## workpad comment

a persistent beads comment used as a living scratchpad across agent sessions.

### find current workpad

comments are append-only. there is no edit-in-place. the current workpad is the latest comment whose body starts with `## Plot Workpad`.

```bash
bd comments <id> --json
```

scan the returned comments and pick the latest one with:

```text
## Plot Workpad
```

if none exists, create one.

### create workpad

write the full workpad body to a temp file, then add it as a comment:

````bash
cat > /tmp/workpad.md <<'WORKPAD'
## Plot Workpad

```text
<workspace-id>@<short-sha>
```

### Plan
- [ ] 1. <task>

### Acceptance Criteria
- [ ] <criterion>

### Validation
- [ ] targeted tests: `<command>`

### Latest Attempt Summary
- changed: <files or none>
- validated: <commands + outcome>
- failed: <remaining failure or none>
- blocked: <blocker or none>

### Notes
- <durable context>
WORKPAD

bd comments add <id> -f /tmp/workpad.md
````

### update workpad

do not try to edit an old comment. add a new full workpad comment with the complete updated body.

````bash
cat > /tmp/workpad.md <<'WORKPAD'
...full updated workpad body...
WORKPAD

bd comments add <id> -f /tmp/workpad.md
````

### rules

- treat the latest `## Plot Workpad` comment as canonical
- never rely on older workpad comments once a newer one exists
- update the workpad after every meaningful milestone
- never leave completed items unchecked
- include workspace id and short sha at top: `<workspace-id>@<short-sha>`
- keep the full workpad body in each update so the latest comment is self-contained

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
# full issue details, including comments
bd show <id> --json

# all comments
bd comments <id> --json

# list by status
bd list --status open --json
bd list --status in_progress --json
bd list --status blocked --json
bd list --status deferred --json
bd list --status closed --json

# ready work: open + no blockers
bd ready --json

# complex filters
bd query "status=open AND priority<=1" --json

# text search
bd search "keyword" --json

# dependencies
bd dep list <id>
```

use `bd show <id> --json` when you need the full issue payload. use `bd comments <id> --json` when you need comment history or the current workpad.

## out-of-scope issue creation

if you discover unrelated work, file a separate beads issue instead of expanding scope:

```bash
bd create "discovered: <title>" -t task -p 2 -d "<description>" --labels "plot:todo,discovered"
```

keep the new issue narrow and factual. reference the triggering issue in the description when useful.
