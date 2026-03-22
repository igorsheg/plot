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

## invariants

- this is unattended. never ask a human to do something.
- the workpad comment is the durable memory. create it before any code changes. keep it current.
- work only on the assigned issue. file separate issues for unrelated discoveries via `gh issue create --repo "$GITHUB_REPO"`.
- do not claim success without evidence (test output, typecheck pass, lint pass).
- on retries, resume from workspace state — don't restart unless workpad/repo state demands it.

## routing

| state             | action                                                                 |
| ----------------- | ---------------------------------------------------------------------- |
| plot:todo         | transition to `plot:in-progress`, then run implementation flow         |
| plot:in-progress  | continue implementation flow                                           |
| plot:human-review | stop — wait for human                                                  |
| plot:rework       | read all PR feedback, fix or reply, verify, transition to human-review |
| plot:merging      | load `plot-land` skill, merge                                         |
| plot:done         | stop                                                                   |

transition labels:

```bash
gh issue edit <number> --repo "$GITHUB_REPO" --remove-label "<old>" --add-label "<new>"
```

if branch PR is `CLOSED` or `MERGED`, create a fresh branch from `origin/main` and restart.

## workpad contract

exactly one `## Plot Workpad` comment per issue. create before code changes. update in place — never create duplicates.

```bash
# find existing
gh api repos/$GITHUB_REPO/issues/<number>/comments \
  --jq '.[] | select(.body | startswith("## Plot Workpad")) | .id' | head -1

# create (only if none exists)
gh api repos/$GITHUB_REPO/issues/<number>/comments -X POST -f body='## Plot Workpad
...'

# update in place
gh api repos/$GITHUB_REPO/issues/comments/<id> -X PATCH -f body='## Plot Workpad
...'
```

required sections: `Plan` (checklist), `Acceptance Criteria`, `Validation` (commands + results), `Latest Attempt Summary`, `Notes`.

template:

````markdown
## Plot Workpad

```text
<workspace-id>@<short-sha>
```

### Plan

- [ ] 1. task
  - [ ] 1.1 subtask

### Acceptance Criteria

- [ ] criterion

### Validation

- [ ] `<command>`: <pass/fail>

### Latest Attempt Summary

- changed: <files or none>
- validated: <commands + outcome>
- blocked: <blocker or none>

### Notes

- <durable context>
````

## implementation flow

1. create or update workpad with plan and acceptance criteria
2. sync with `origin/main` (load `plot-pull-main` skill)
3. implement — keep diffs minimal
4. verify: `bun run typecheck && bun run lint`
5. update workpad with evidence
6. commit (load `plot-commit` skill) and push PR (load `plot-push-pr` skill, ensure `Resolves #<number>`)
7. transition to `plot:human-review`

## completion bar

all must be true before transitioning to `plot:human-review`:

- workpad plan is complete and checked off
- acceptance criteria satisfied with evidence
- verification green (typecheck + lint)
- PR pushed, linked to issue
- workpad reflects current state

## skills

load on demand: `plot-commit`, `plot-push-pr`, `plot-pull-main`, `plot-land`, `plot-debug`
