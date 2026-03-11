---
name: plot-debug
description: "investigate stuck runs, retry loops, and execution failures in the plot orchestrator. correlates logs by issue id, workspace path, and session state. use when runs stall, retry repeatedly, or fail unexpectedly."
---

# plot-debug

## goals

- find why a run is stuck, retrying, or failing
- correlate issue identity to agent session and workspace
- read the right logs in the right order to isolate root cause

## log sources

plot logs to stdout as structured key-value pairs. relevant log messages include:

| message                 | meaning                              |
| ----------------------- | ------------------------------------ |
| `dispatch`              | agent dispatched for issue           |
| `agent_session_created` | pi session started in workspace      |
| `retry_scheduled`       | retry queued (continuation or error) |
| `retry_issue_gone`      | issue disappeared during retry       |
| `reconcile`             | active run state check               |
| `tick`                  | poll cycle summary                   |
| `workspace_ready`       | workspace created/reused             |
| `agent_failed`          | agent exited with error              |
| `worker_interrupted`    | agent was stopped by reconciliation  |

## correlation keys

- `issue_id` — numeric github issue number
- `identifier` — human-readable `#N`
- `state` — issue state at dispatch time
- `workspace` — absolute workspace path
- `attempt` — retry attempt number
- `error` — failure reason (or `continuation` for normal re-check)

## quick triage

### issue not being picked up

```bash
# check if issue has correct label
gh issue view <number> --repo $GITHUB_REPO --json labels

# check server logs for candidate detection
# look for tick logs showing candidates > 0
```

possible causes:

- missing or wrong `plot:*` state label (unlabeled issues are ignored)
- issue already claimed (check `running` or `retrying` counts)
- no available slots (`max_concurrent_agents` reached)
- issue has non-terminal blockers (`plot:todo` state only)

### agent stuck / not progressing

```bash
# check if session is still running
# look for recent reconcile logs with stopped: 0

# check stall timeout config
# default: 120000ms (2 min) — if no events for this long, agent is killed
```

possible causes:

- agent waiting for user input (hard fail in pi)
- stall timeout too short for complex tasks
- workspace has broken state (missing deps, corrupt git)

### retry loop

```bash
# look for repeated retry_scheduled logs for same issue_id
# check error field — if "continuation", agent completed normally
# if actual error, check the error message
```

possible causes:

- `continuation` retries are normal (agent finished, orchestrator re-checks if issue still active)
- `retry_issue_gone` means issue was closed/moved to terminal state during retry
- real errors trigger exponential backoff: 10s, 20s, 40s... up to max_retry_backoff_ms

### workspace issues

```bash
# check workspace exists and is valid
ls -la workspaces/<workspace-key>/

# check git worktree state
cd workspaces/<workspace-key> && git status

# check if hooks failed (after_create, before_run)
# look for hook timeout/failure in logs
```

## investigation flow

1. identify the issue: `identifier` or `issue_id`
2. find dispatch logs: look for `dispatch` with matching identifier
3. find session logs: look for `agent_session_created` with matching issue_id
4. check outcome: `retry_scheduled` (error field tells you why)
5. if stuck: check `reconcile` logs — is `stopped` incrementing?
6. if retry loop: check retry `attempt` numbers — are they climbing?

## orchestrator state

the server exposes runtime state at `http://localhost:3000/rpc` via RPC. the dashboard at `http://localhost:3000` shows:

- running sessions with turn counts and token usage
- retry queue with attempt numbers and due times
- aggregate token totals and runtime
