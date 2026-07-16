# Plot debug lab extension

A realistic, long-running extension for debugging the live TUI and web dashboard.

It creates exactly three concurrent synthetic Work Items:

- `INC` — triage a checkout latency regression
- `REL` — prepare a release readiness brief
- `DEP` — plan a dependency upgrade campaign

Each item has its own workspace, emits progress checkpoints, waits between stages, writes markdown artifacts, and finishes with a handoff summary. The workload recurs on a configurable cycle so you can leave it running while inspecting the TUI and web UI.

## Run

From the repository root:

```bash
plot examples/debug/WORKFLOW.md
```

In another terminal:

```bash
plot web
```

The extension is designed to run for a long time without intentionally creating failures, cancellations, or timeout noise.

## What to look for

- Three Work Items should start together because `maxConcurrentRuns` is `3`.
- Each row should look like normal operational work rather than a synthetic state matrix.
- Agent attempts should show progress tool calls, wait periods, artifact writes, and completion.
- Completed work disappears until the next `cycleMs` interval creates a new version.
- Artifacts and extension hook logs are written under the session debug workspace.

Extension events are appended to:

```txt
<sessionDir>/debug-workspaces/extension-events.jsonl
```

Per-work artifacts are written under:

```txt
<sessionDir>/debug-workspaces/<work-id>/
```

## Config

Edit `WORKFLOW.md` under `extension.config`:

- `cycleMs`: how often the three streams recur with a new version
- `stepDelayMs`: default wait time between scenario steps
- `simulateDiscoveryFailureEvery`: `0` disables; a positive number throws every Nth discover tick
- `workspaceRoot`: optional absolute directory for debug artifacts

The default workflow runs three concurrent items, each with three staged waits, and avoids intentional failure/timeout/cancellation states. If you want the old edge-state stress behavior, keep it as a separate example rather than mixing it into this realistic dashboard workload.
