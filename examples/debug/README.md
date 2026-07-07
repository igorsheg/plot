# Plot debug lab extension

A synthetic, long-running Plot extension for debugging the live TUI and web dashboard.

It continuously creates Work Items that exercise:

- `pending`, `running`, `waiting`, `blocked`, `draining`, `done`, `failed`, `cancelled/interrupted`, and `timed_out` paths
- display hints: primary text, titles, subtitles, versions, labels, and subjects
- per-source concurrency and queued pending rows
- custom tools, tool details, tool termination, and workspace artifacts
- lifecycle hooks: started, completed, failed, interrupted, timedOut, operatorAction, shutdown
- operator actions from the TUI/web dashboard
- retry backoff and scheduled wake projection after failure/timeout
- optional discovery failures while retaining last-known work

## Run

From the repository root:

```bash
plot --workflow examples/debug/WORKFLOW.md
```

In another terminal:

```bash
plot web
```

The extension is designed to run forever. Stop it with the normal TUI quit/shutdown flow.

## What to look for

- `WAIT` stays visible and is never dispatched.
- `ACTION` is blocked and exposes operator buttons. Use **Release once** to turn it into runnable work.
- `W1`..`W6` create enough work to show source concurrency and pending/running transitions.
- `TOOL` writes an artifact under the session debug workspace and terminates through a custom tool result.
- `DRAIN` disappears from discovery while running, so the dashboard can show `draining`.
- `CANCEL` is returned as `cancelled` after start, so Plot interrupts and releases it.
- `FAIL` uses an intentionally invalid workspace under `/dev/null` to trigger a failed attempt and retry wake.
- `TIME` asks the agent to sleep longer than `maxRunDurationMs`, producing timeout and retry behavior.

Extension events are appended to:

```txt
<sessionDir>/debug-workspaces/extension-events.jsonl
```

## Config

Edit `WORKFLOW.md` under `extension.config`:

- `cycleMs`: new wave/version interval
- `waveSize`: number of queued wave items per cycle
- `shortSleepMs`: sleep used by normal synthetic runs
- `longSleepMs`: sleep used for drain/cancel/timeout scenarios
- `drainAfterMs`: how long after start before `DRAIN` disappears from discovery
- `includeFailure`, `includeTimeout`, `includeCancellation`, `includeDrain`: scenario toggles
- `simulateDiscoveryFailureEvery`: `0` disables; a positive number throws every Nth discover tick
- `workspaceRoot`: optional absolute directory for debug artifacts

This extension intentionally spends agent turns. Reduce `waveSize`, disable timeout/failure scenarios, or increase `cycleMs` when you only need a small UI sample.
