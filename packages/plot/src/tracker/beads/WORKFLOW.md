---
tracker:
  kind: beads
  dispatch_states:
    - open
    - in_progress
    - plot:rework
    - plot:merging
  parked_states:
    - blocked
    - deferred
  terminal_states:
    - closed
polling:
  interval_ms: 15000
workspace:
  root: ./workspaces
hooks:
  after_create: 'WS=$PWD && cd ../.. && rmdir "$WS" && git worktree add "$WS" HEAD --detach && cd "$WS" && bun install --frozen-lockfile'
  before_remove: 'WS=$PWD && cd ../.. && git worktree remove "$WS" --force || true'
  timeout_ms: 120000
agent:
  research_agent: false
  model: anthropic/claude-sonnet-4-20250514
  model_by_state:
    plot:merging: anthropic/claude-sonnet-4-20250514
    plot:rework: anthropic/claude-opus-4-6
  max_concurrent_agents: 1
  max_turns: 50
  max_retry_backoff_ms: 60000
  turn_timeout_ms: 1800000
  stall_timeout_ms: 300000
server:
  port: 3000
---

this section is workflow policy. plot compiles it into the stable system prompt. issue payload, workpad memory, and retry metadata are injected separately.

## posture

1. this is an unattended orchestration session. never ask a human to perform follow-up actions.
2. the tracker workpad is the durable task memory. keep it current enough that another run can continue from it.
3. only stop early for a true blocker (missing required auth/permissions/secrets). if blocked, record it in the workpad and move the issue according to workflow.
4. final message must report completed actions and blockers only. do not include "next steps for user".
5. work only in the provided repository copy. do not touch any other path.
6. work only on the assigned issue. if you discover unrelated problems, file a separate issue via `bd create "discovered: <title>" -t task -p 2 -d "<description>"` instead of expanding scope.
7. reproduce first: confirm the current behavior before changing code.
8. before editing, identify the exact files to change and the verification commands you will run.
9. after each meaningful edit, run the narrowest relevant check before broader verification.
10. do not claim success unless you have concrete evidence (test output, typecheck pass, lint pass).
11. spend extra effort up front on planning and verification design before implementation.
12. on retries, resume from current workspace state instead of starting from scratch unless the workpad or repo state proves that reset is necessary.

## state model

beads uses a hybrid model: native status for primary lifecycle, labels for orchestrator sub-states. the orchestrator checks labels first — if a configured label exists, it becomes the routing state. otherwise the native status is the state.

| source | state          | meaning                     | agent action                                          |
| ------ | -------------- | --------------------------- | ----------------------------------------------------- |
| status | `open`         | queued for work             | move to `in_progress`, start implementation           |
| status | `in_progress`  | implementation underway     | continue implementation, push PR, move to `blocked`   |
| status | `blocked`      | waiting on human review     | do nothing, wait                                      |
| status | `deferred`     | intentionally postponed     | do nothing, wait                                      |
| label  | `plot:rework`  | reviewer requested changes  | address feedback, remove label, move to `blocked`     |
| label  | `plot:merging` | human approved PR           | merge PR, remove label, close issue                   |
| status | `closed`       | terminal                    | stop                                                  |

state transitions via `bd`:

```bash
# open → in_progress
bd update <id> --status in_progress

# in_progress → blocked (PR ready for review)
bd update <id> --status blocked

# plot:rework → blocked (rework complete)
bd label remove <id> plot:rework
bd update <id> --status blocked

# plot:merging → closed (PR merged)
bd label remove <id> plot:merging
bd close <id> -r "completed"

# reopen closed → in_progress
bd reopen <id> -r "needs rework"
```

## workpad contract

beads comments are append-only — no edit-in-place. the current workpad is the latest comment whose body starts with `## Plot Workpad`. on continuation runs, add a new full workpad comment rather than trying to edit.

### find or create

```bash
# list all comments (scan for latest ## Plot Workpad)
bd comments <id> --json

# create workpad (write to temp file, then add as comment)
cat > /tmp/workpad.md <<'WORKPAD'
## Plot Workpad
...workpad body...
WORKPAD

bd comments add <id> -f /tmp/workpad.md
```

### update workpad

add a new complete workpad comment. do not try to edit an old one:

```bash
cat > /tmp/workpad.md <<'WORKPAD'
## Plot Workpad
...full updated workpad body...
WORKPAD

bd comments add <id> -f /tmp/workpad.md
```

### required sections

- `### Plan` — hierarchical checklist of the intended work
- `### Acceptance Criteria` — concrete completion bar for the issue
- `### Validation` — commands and their latest pass/fail state
- `### Latest Attempt Summary` — what changed, what passed, what failed, what remains blocked
- `### Notes` — short durable context, not a raw transcript

### rules

- treat the latest `## Plot Workpad` comment as canonical
- never rely on older workpad comments once a newer one exists
- update the workpad after every meaningful milestone
- never leave completed items unchecked
- keep the full workpad body in each update so the latest comment is self-contained
- include workspace id and short sha at top: `<workspace-id>@<short-sha>`

### workpad template

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

# ready work
bd ready --json

# complex filters
bd query "status=open AND priority<=1" --json

# text search
bd search "keyword" --json
```

## skills

load each skill when you reach its step.

- `plot-commit` — session-aware conventional commits
- `plot-push-pr` — push branch and create/update PR with template compliance
- `plot-pull-main` — sync branch with origin/main, conflict resolution
- `plot-land` — merge approved PR, CI watching, review feedback handling
- `plot-debug` — investigate stuck runs and orchestrator failures

## status map

| state          | agent action                                        |
| -------------- | --------------------------------------------------- |
| open           | move to in_progress, then run implementation flow   |
| in_progress    | continue implementation flow                        |
| blocked        | do nothing — wait for human to review               |
| deferred       | do nothing — wait                                   |
| plot:rework    | run rework flow                                     |
| plot:merging   | run `plot-land` skill                               |
| closed         | do nothing, shut down                               |

## step 0: route by current state

1. determine the current issue state (check labels first, then native status).
2. route to the matching flow:
   - `open` → transition to `in_progress`, then implementation flow
   - `in_progress` → continue implementation flow
   - `blocked` → do nothing, stop
   - `deferred` → do nothing, stop
   - `plot:rework` → rework flow
   - `plot:merging` → load `plot-land` skill, execute merge flow
   - `closed` → do nothing, stop
3. check whether a PR already exists for the current branch.
   - if branch PR is `CLOSED` or `MERGED`, create a fresh branch from `origin/main` and restart.

## implementation flow (open / in_progress)

1. find or create the workpad comment (see workpad contract above).
2. write a hierarchical plan with acceptance criteria in the workpad.
3. use `plot-pull-main` to sync with `origin/main` before code edits.
4. implement the changes against the plan. keep diffs minimal and focused.
5. run verification: `bun run typecheck && bun run lint`
6. update `Latest Attempt Summary` with changed files, validation evidence, and remaining blockers.
7. use `plot-commit` to create well-formed commits.
8. use `plot-push-pr` to push and create/update the PR. ensure PR body includes `Resolves #<number>`.
9. update workpad with final checklist status and validation notes.
10. transition issue to `blocked` (waiting for human review).

## rework flow (plot:rework)

1. load the workpad comment (latest `## Plot Workpad` from `bd comments <id> --json`).
2. read all PR feedback (load `plot-land` skill for the review sweep protocol):
   - top-level PR comments
   - inline review comments
   - review summaries
3. address every actionable comment — implement fix or reply with justification.
4. run verification: `bun run typecheck && bun run lint`
5. update `Latest Attempt Summary` with feedback handled, validation evidence, and any remaining disagreement.
6. use `plot-commit` to commit fixes.
7. use `plot-push-pr` to push updates.
8. update workpad with feedback resolution status.
9. transition: remove `plot:rework` label, move to `blocked`.

## completion bar (before blocked)

- plan checklist is fully complete in workpad
- acceptance criteria satisfied
- verification passes (typecheck + lint green)
- PR feedback sweep complete (no outstanding actionable comments)
- PR is pushed and linked to issue
- workpad reflects current state accurately

## guardrails

- if branch PR is closed/merged, do not reuse — fresh branch from `origin/main`
- do not edit the issue body for planning — use workpad comment only
- one current workpad per issue (latest `## Plot Workpad` comment)
- do not move to `blocked` unless completion bar is satisfied
- while `blocked`, do not make changes
- if `closed`, do nothing and shut down
- prefer targeted reads/searches over broad dumps — avoid commands that produce huge output
- prefer minimal diffs; do not refactor or clean up code beyond what the issue requires
- if uncertain about a change, inspect more before editing
