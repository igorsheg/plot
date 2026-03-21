---
tracker:
  kind: github
  dispatch_states:
    - plot:todo
    - plot:in-progress
    - plot:rework
    - plot:merging
  parked_states:
    - plot:human-review
  terminal_states:
    - plot:done
polling:
  interval_ms: 15000
workspace:
  root: ./workspaces
hooks:
  after_create: 'WS=$PWD && cd ../.. && rmdir "$WS" && git worktree add "$WS" HEAD --detach && cd "$WS" && bun install --frozen-lockfile'
  before_remove: 'WS=$PWD && cd ../.. && git worktree remove "$WS" --force || true'
  timeout_ms: 120000
agent:
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
6. work only on the assigned issue. if you discover unrelated problems, file a separate issue via `gh issue create --repo "$GITHUB_REPO"` instead of expanding scope.
7. reproduce first: confirm the current behavior before changing code.
8. before editing, identify the exact files to change and the verification commands you will run.
9. after each meaningful edit, run the narrowest relevant check before broader verification.
10. do not claim success unless you have concrete evidence (test output, typecheck pass, lint pass).
11. spend extra effort up front on planning and verification design before implementation.
12. on retries, resume from current workspace state instead of starting from scratch unless the workpad or repo state proves that reset is necessary.

## state model

github uses a label-based state model. all states are labels prefixed with `plot:`.

| label             | meaning                    | agent action                                          |
| ----------------- | -------------------------- | ----------------------------------------------------- |
| plot:todo         | queued for work            | move to plot:in-progress, start execution             |
| plot:in-progress  | implementation underway    | implement, verify, open PR, move to plot:human-review |
| plot:human-review | PR open, waiting on human  | do nothing, wait                                      |
| plot:rework       | reviewer requested changes | read feedback, fix, move to plot:human-review         |
| plot:merging      | human approved             | merge PR, move to plot:done                           |
| plot:done         | terminal                   | stop                                                  |

transition by removing the previous `plot:*` label and adding the new one:

```bash
# todo -> in-progress
gh issue edit <number> --repo "$GITHUB_REPO" --remove-label "plot:todo" --add-label "plot:in-progress"

# in-progress -> human-review
gh issue edit <number> --repo "$GITHUB_REPO" --remove-label "plot:in-progress" --add-label "plot:human-review"

# rework -> human-review
gh issue edit <number> --repo "$GITHUB_REPO" --remove-label "plot:rework" --add-label "plot:human-review"

# merging -> done, then close
gh issue edit <number> --repo "$GITHUB_REPO" --remove-label "plot:merging" --add-label "plot:done"
gh issue close <number> --repo "$GITHUB_REPO"
```

to reopen a terminal issue:

```bash
gh issue reopen <number> --repo "$GITHUB_REPO"
gh issue edit <number> --repo "$GITHUB_REPO" --remove-label "plot:done" --add-label "plot:rework"
```

## workpad contract

keep exactly one `## Plot Workpad` comment per issue. on continuation runs, update the existing comment in place — do not create duplicates.

### find or create

```bash
# find existing workpad comment id
gh api repos/$GITHUB_REPO/issues/<number>/comments \
  --jq '.[] | select(.body | startswith("## Plot Workpad")) | .id' | head -1

# create new workpad (only if none exists)
gh api repos/$GITHUB_REPO/issues/<number>/comments -X POST -f body='## Plot Workpad
...workpad body...'

# update existing workpad in place
gh api repos/$GITHUB_REPO/issues/comments/<id> -X PATCH -f body='## Plot Workpad
...full updated workpad body...'
```

### required sections

- `### Plan` — hierarchical checklist of the intended work
- `### Acceptance Criteria` — concrete completion bar for the issue
- `### Validation` — commands and their latest pass/fail state
- `### Latest Attempt Summary` — what changed, what passed, what failed, what remains blocked
- `### Notes` — short durable context, not a raw transcript

### rules

- exactly one workpad comment per issue, identified by `## Plot Workpad` header
- reuse existing comment on continuation runs — do not create duplicates
- when a checklist item is done, mark it done immediately
- keep `Latest Attempt Summary` short and factual
- if a retry changed the plan, update the workpad before large edits
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
# view issue details
gh issue view <number> --repo "$GITHUB_REPO" --json title,body,state,labels,comments

# list open issues by label
gh issue list --repo "$GITHUB_REPO" --label "plot:in-progress" --state open
```

## skills

load each skill when you reach its step.

- `plot-commit` — session-aware conventional commits
- `plot-push-pr` — push branch and create/update PR with template compliance
- `plot-pull-main` — sync branch with origin/main, conflict resolution
- `plot-land` — merge approved PR, CI watching, review feedback handling
- `plot-debug` — investigate stuck runs and orchestrator failures

## status map

| state             | agent action                                           |
| ----------------- | ------------------------------------------------------ |
| plot:todo         | move to plot:in-progress, then run implementation flow |
| plot:in-progress  | continue implementation flow                           |
| plot:human-review | do nothing — wait for human to review                  |
| plot:rework       | run rework flow                                        |
| plot:merging      | run `plot-land` skill                                  |
| plot:done         | do nothing, shut down                                  |

## step 0: route by current state

1. determine the current issue state from its `plot:*` labels.
2. route to the matching flow:
   - `plot:todo` → transition to `plot:in-progress`, then implementation flow
   - `plot:in-progress` → continue implementation flow
   - `plot:human-review` → do nothing, stop
   - `plot:rework` → rework flow
   - `plot:merging` → load `plot-land` skill, execute merge flow
   - `plot:done` → do nothing, stop
3. check whether a PR already exists for the current branch.
   - if branch PR is `CLOSED` or `MERGED`, create a fresh branch from `origin/main` and restart.

## implementation flow (plot:todo / plot:in-progress)

1. find or create the workpad comment (see workpad contract above).
2. write a hierarchical plan with acceptance criteria in the workpad.
3. use `plot-pull-main` to sync with `origin/main` before code edits.
4. implement the changes against the plan. keep diffs minimal and focused.
5. run verification: `bun run typecheck && bun run lint`
6. update `Latest Attempt Summary` with changed files, validation evidence, and remaining blockers.
7. use `plot-commit` to create well-formed commits.
8. use `plot-push-pr` to push and create/update the PR. ensure PR body includes `Resolves #<number>`.
9. update workpad with final checklist status and validation notes.
10. transition issue to `plot:human-review`.

## rework flow (plot:rework)

1. load the workpad comment.
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
9. transition: remove `plot:rework`, add `plot:human-review`.

## completion bar (before human-review)

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
- do not move to `plot:human-review` unless completion bar is satisfied
- while `plot:human-review`, do not make changes
- if `plot:done`, do nothing and shut down
- prefer targeted reads/searches over broad dumps — avoid commands that produce huge output
- prefer minimal diffs; do not refactor or clean up code beyond what the issue requires
- if uncertain about a change, inspect more before editing
