---
name: plot-beads-tracker
description: "beads issue state management for plot orchestration. hybrid model: native beads status for primary lifecycle, labels for orchestrator sub-states (rework, merging). workpad comment lifecycle and bd queries. use when moving issues between states, creating/updating workpad comments, or querying issue status."
---

# plot-beads-tracker

manages issue state and progress tracking for the plot orchestrator via beads status, labels, and comments.

use `bd` for all tracker operations. the git/PR lifecycle uses `gh` separately.

## state model

beads uses a hybrid state model with two layers:

- **status** (native beads lifecycle): `open`, `in_progress`, `blocked`, `deferred`, `closed`
- **labels** (orchestrator sub-states): `plot:rework`, `plot:merging`

the orchestrator checks labels first. if a configured label exists on the issue, it becomes the routing state. otherwise the native beads status is the state.

```
                  ┌─────────┐
                  │  open    │  agent picks up, starts work
                  └────┬────┘
                       │ bd update <id> --status in_progress
                       ▼
                ┌─────────────┐
                │ in_progress  │  agent implements, pushes PR
                └──────┬──────┘
                       │ bd update <id> --status blocked
                       ▼
                  ┌─────────┐
                  │ blocked  │  human reviews PR
                  └────┬────┘
                       │
            ┌──────────┼──────────┐
            ▼          ▼          ▼
     ┌────────────┐  ┌─────────────────┐  ┌────────┐
     │plot:rework │  │  plot:merging    │  │closed  │
     │(label)     │  │  (label)        │  │(reject)│
     └─────┬──────┘  └───────┬─────────┘  └────────┘
           │                 │
           │ agent fixes,    │ agent merges PR,
           │ removes label,  │ removes label,
           │ → blocked       │ closes issue
           │                 │
           ▼                 ▼
      ┌─────────┐      ┌────────┐
      │ blocked  │      │ closed │
      └─────────┘      └────────┘
```

## state transitions

```bash
# open → in_progress (starting work)
bd update <id> --status in_progress

# in_progress → blocked (PR ready for review)
bd update <id> --status blocked

# human approves → add merging label (human does this)
bd label add <id> plot:merging

# human requests changes → add rework label (human does this)
bd label add <id> plot:rework

# plot:rework → blocked (rework complete, remove label first)
bd label remove <id> plot:rework
bd update <id> --status blocked

# plot:merging → closed (PR merged, remove label first)
bd label remove <id> plot:merging
bd close <id> -r "completed"

# reopen closed → in_progress
bd reopen <id> -r "needs rework"
```

## available states

| source | state          | meaning                     | agent action                                          |
| ------ | -------------- | --------------------------- | ----------------------------------------------------- |
| status | `open`         | queued for work             | move to `in_progress`, start implementation           |
| status | `in_progress`  | implementation underway     | continue implementation, push PR, move to `blocked`   |
| status | `blocked`      | waiting on human review     | do nothing, wait                                      |
| status | `deferred`     | intentionally postponed     | do nothing, wait                                      |
| label  | `plot:rework`  | reviewer requested changes  | address feedback, remove label, move to `blocked`     |
| label  | `plot:merging` | human approved PR           | merge PR, remove label, close issue                   |
| status | `closed`       | terminal                    | stop                                                  |

workflow routing:

- dispatch_states: `open`, `in_progress`, `plot:rework`, `plot:merging`
- parked_states: `blocked`, `deferred`
- terminal_states: `closed`

## workpad comment

a persistent beads comment used as a living scratchpad across agent sessions.

### find current workpad

comments are append-only. there is no edit-in-place. the current workpad is the latest comment whose body starts with `## Plot Workpad`.

```bash
bd comments <id> --json
```

scan the returned comments and pick the latest one starting with `## Plot Workpad`.

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
# full issue details
bd show <id> --json

# all comments (for workpad lookup)
bd comments <id> --json

# list by status
bd list --status open --json
bd list --status in_progress --json
bd list --status blocked --json

# list by label
bd list --label plot:rework --json
bd list --label plot:merging --json

# ready work: open + no blockers
bd ready --json

# complex filters
bd query "status=open AND priority<=1" --json
bd query "label=plot:rework" --json

# text search
bd search "keyword" --json

# dependencies
bd dep list <id>
```

## out-of-scope issue creation

if you discover unrelated work, file a separate beads issue instead of expanding scope:

```bash
bd create "discovered: <title>" -t task -p 2 -d "<description>"
```

keep the new issue narrow and factual. reference the triggering issue in the description when useful.
