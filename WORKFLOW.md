---
tracker:
  kind: github
  dispatch_states:
    - Todo
    - In Progress
    - Rework
    - Merging
  parked_states:
    - Human Review
  terminal_states:
    - Done
    - Closed
    - Cancelled
polling:
  interval_ms: 15000
workspace:
  root: ./workspaces
hooks:
  after_create: "WS=$PWD && cd ../.. && rmdir \"$WS\" && git worktree add \"$WS\" HEAD --detach && cd \"$WS\" && bun install --frozen-lockfile"
  before_remove: "WS=$PWD && cd ../.. && git worktree remove \"$WS\" --force || true"
  timeout_ms: 120000
agent:
  max_concurrent_agents: 5
  max_turns: 50
  max_retry_backoff_ms: 60000
codex:
  command: pi
  turn_timeout_ms: 1800000
  stall_timeout_ms: 120000
server:
  port: 3000
---

You are working on issue **{{ issue.identifier }}: {{ issue.title }}** in the `igorsheg/plot` repository.

{% if issue.description %}
## Description
{{ issue.description }}
{% endif %}

{% if issue.labels.size > 0 %}
**Labels**: {{ issue.labels | join: ", " }}
{% endif %}

{% if attempt %}
Continuation context:
- This is retry attempt #{{ attempt }} because the issue is still in an active state.
- Resume from the current workspace state instead of restarting from scratch.
- Do not repeat already-completed investigation or validation unless needed for new code changes.
- Do not end the turn while the issue remains in an active state unless you are blocked by missing required permissions/secrets.
{% else %}
Start fresh. Read the codebase, understand the context, then implement the changes.
{% endif %}

## Posture

1. This is an unattended orchestration session. Never ask a human to perform follow-up actions.
2. Only stop early for a true blocker (missing required auth/permissions/secrets). If blocked, record it in the workpad and move the issue according to workflow.
3. Final message must report completed actions and blockers only. Do not include "next steps for user".
4. Work only in the provided repository copy. Do not touch any other path.
5. Reproduce first: confirm the current behavior before changing code.
6. Spend extra effort up front on planning and verification design before implementation.

## Skills

Use these project skills during execution. Load each skill when you reach its step.

- `plot-github-tracker` — issue state transitions via labels, workpad comment lifecycle
- `plot-commit` — session-aware conventional commits
- `plot-push-pr` — push branch and create/update PR with template compliance
- `plot-pull-main` — sync branch with origin/main, conflict resolution
- `plot-land` — merge approved PR, CI watching, review feedback handling
- `plot-debug` — investigate stuck runs and orchestrator failures

## Status map

| state | agent action |
|-------|-------------|
| Todo | move to In Progress, then run implementation flow |
| In Progress | continue implementation flow |
| Human Review | do nothing — wait for human to change state |
| Rework | run rework flow |
| Merging | run `plot-land` skill |
| Done / Closed | do nothing, shut down |

## Step 0: Route by current state

1. Determine the current issue state from labels.
2. Route to the matching flow:
   - `Todo` → use `plot-github-tracker` to move to In Progress, then implementation flow
   - `In Progress` → continue implementation flow
   - `Human Review` → do nothing, stop
   - `Rework` → rework flow
   - `Merging` → load `plot-land` skill, execute merge flow
   - `Done` / `Closed` → do nothing, stop
3. Check whether a PR already exists for the current branch.
   - If branch PR is `CLOSED` or `MERGED`, create a fresh branch from `origin/main` and restart.

## Implementation flow (Todo / In Progress)

1. Use `plot-github-tracker` to find or create the workpad comment.
2. Write a hierarchical plan with acceptance criteria in the workpad.
3. Use `plot-pull-main` to sync with `origin/main` before code edits.
4. Implement the changes against the plan. Keep diffs minimal and focused.
5. Run verification: `bun run typecheck && bun run lint`
6. Use `plot-commit` to create well-formed commits.
7. Use `plot-push-pr` to push and create/update the PR.
8. Update workpad with final checklist status and validation notes.
9. Use `plot-github-tracker` to move issue to `Human Review`.

Do NOT close the issue. A human will review the PR.

## Rework flow (Rework)

1. Use `plot-github-tracker` to load the workpad.
2. Read ALL PR feedback (load `plot-land` skill for the review sweep protocol):
   - top-level PR comments
   - inline review comments
   - review summaries
3. Address every actionable comment — implement fix or reply with justification.
4. Run verification: `bun run typecheck && bun run lint`
5. Use `plot-commit` to commit fixes.
6. Use `plot-push-pr` to push updates.
7. Update workpad with feedback resolution status.
8. Use `plot-github-tracker` to move issue back to `Human Review`.

## Completion bar (before Human Review)

- Plan checklist is fully complete in workpad
- Acceptance criteria satisfied
- Verification passes (typecheck + lint green)
- PR feedback sweep complete (no outstanding actionable comments)
- PR is pushed and linked to issue
- Workpad reflects current state accurately

## Guardrails

- If branch PR is closed/merged, do not reuse — fresh branch from `origin/main`
- Do not edit the issue body for planning — use workpad comment only
- Exactly one workpad comment per issue (`## Plot Workpad`)
- Do not move to `Human Review` unless completion bar is satisfied
- In `Human Review`, do not make changes
- If `Done`, do nothing and shut down
- If out-of-scope improvements are discovered, file a separate issue instead of expanding scope
