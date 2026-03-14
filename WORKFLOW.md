---
tracker:
  kind: beads
  dispatch_states:
    - plot:todo
    - plot:in-progress
    - plot:rework
    - plot:merging
  parked_states:
    - plot:human-review
  terminal_states:
    - plot:done
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
  max_concurrent_agents: 5
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
6. work only on the assigned issue. if you discover unrelated problems, file a separate issue instead of expanding scope.
7. reproduce first: confirm the current behavior before changing code.
8. before editing, identify the exact files to change and the verification commands you will run.
9. after each meaningful edit, run the narrowest relevant check before broader verification.
10. do not claim success unless you have concrete evidence (test output, typecheck pass, lint pass).
11. spend extra effort up front on planning and verification design before implementation.
12. on retries, resume from current workspace state instead of starting from scratch unless the workpad or repo state proves that reset is necessary.

## workpad contract

keep exactly one current `## Plot Workpad` comment per issue. structure it so both humans and later runs can parse it quickly.

beads comments are append-only. the current workpad is always the **latest** comment whose body starts with `## Plot Workpad`. when updating, add a new full workpad comment — do not attempt to edit old comments.

required sections:

- `### Plan` — hierarchical checklist of the intended work
- `### Acceptance Criteria` — concrete completion bar for the issue
- `### Validation` — commands and their latest pass/fail state
- `### Latest Attempt Summary` — what changed, what passed, what failed, what remains blocked
- `### Notes` — short durable context, not a raw transcript

rules:

- treat the latest `## Plot Workpad` comment as canonical
- never rely on older workpad comments once a newer one exists
- when a checklist item is done, mark it done immediately
- keep `Latest Attempt Summary` short and factual
- if a retry changed the plan, update the workpad before large edits
- keep the full workpad body in each update so the latest comment is self-contained

## skills

use these project skills during execution. load each skill when you reach its step.

- `plot-beads-tracker` — issue state transitions via bd set-state, workpad comment lifecycle, issue queries
- `plot-commit` — session-aware conventional commits
- `plot-push-pr` — push branch and create/update PR with template compliance
- `plot-pull-main` — sync branch with origin/main, conflict resolution
- `plot-land` — merge approved PR, CI watching, review feedback handling
- `plot-debug` — investigate stuck runs and orchestrator failures

## status map

| state                | agent action                                      |
| -------------------- | ------------------------------------------------- |
| plot:todo            | move to plot:in-progress, then run implementation flow |
| plot:in-progress     | continue implementation flow                      |
| plot:human-review    | do nothing — wait for human to change state       |
| plot:rework          | run rework flow                                   |
| plot:merging         | run `plot-land` skill                             |
| plot:done / closed   | do nothing, shut down                             |

## step 0: route by current state

1. determine the current issue state from plot dimension labels.
2. if no `plot:*` state label exists, do nothing and stop.
3. route to the matching flow:
   - `plot:todo` → use `plot-beads-tracker` to move to `plot:in-progress`, then implementation flow
   - `plot:in-progress` → continue implementation flow
   - `plot:human-review` → do nothing, stop
   - `plot:rework` → rework flow
   - `plot:merging` → load `plot-land` skill, execute merge flow
   - `plot:done` / `closed` → do nothing, stop
4. check whether a PR already exists for the current branch.
   - if branch PR is `CLOSED` or `MERGED`, create a fresh branch from `origin/main` and restart.

## implementation flow (plot:todo / plot:in-progress)

1. use `plot-beads-tracker` to find or create the workpad comment.
2. write a hierarchical plan with acceptance criteria in the workpad.
3. use `plot-pull-main` to sync with `origin/main` before code edits.
4. implement the changes against the plan. keep diffs minimal and focused.
5. run verification: `bun run typecheck && bun run lint`
6. update `Latest Attempt Summary` with changed files, validation evidence, and remaining blockers.
7. use `plot-commit` to create well-formed commits.
8. use `plot-push-pr` to push and create/update the PR.
9. update workpad with final checklist status and validation notes.
10. use `plot-beads-tracker` to move issue to `plot:human-review`.

## rework flow (plot:rework)

1. use `plot-beads-tracker` to load the workpad.
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
9. use `plot-beads-tracker` to move issue back to `plot:human-review`.

## completion bar (before plot:human-review)

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
- in `plot:human-review`, do not make changes
- if `plot:done`, do nothing and shut down
- if out-of-scope improvements are discovered, file a separate issue via `bd create` instead of expanding scope
- prefer targeted reads/searches over broad dumps — avoid commands that produce huge output
- prefer minimal diffs; do not refactor or clean up code beyond what the issue requires
- if uncertain about a change, inspect more before editing
