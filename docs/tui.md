# Terminal dashboard

```bash
plot WORKFLOW.md
```

The terminal dashboard is an attached operator view of one durable Plot Session.

## Lifecycle

- If the Workflow has no Active Plot Session, Plot starts one.
- Otherwise Plot attaches to the existing Session.
- Durable Session History reconstructs the current projection before live continuation.
- `q` and Ctrl-C detach; they do not stop the Session.
- `plot stop WORKFLOW.md` is the explicit shutdown path.

This ownership rule allows a Workflow to continue discovering and handling Work Items while no dashboard is connected.

## Views

The Process Table shows Source readiness, Work Items, current or latest Agent Runs, scheduled wakes, and diagnostics. Detail views expose Agent Transcript activity and Source-declared Operator Actions.

Source requirements that need human work appear as `Needs You`. Their actions run inside the Session, stream progress, and may open authorization URLs.

## Controls

The dashboard displays its current key map in the footer. Core controls include:

- `q` — detach
- `t` — request a reconciliation tick
- `d` — toggle debug projection details
- `c` — toggle runtime configuration
- arrow keys or `j`/`k` — move selection
- `Enter` — inspect selected work
- `s` — invoke an available Source setup action
- `Esc` — return to the Process Table

The TUI consumes Plot concepts and direct RuntimeEvents through the internal Session Manager. It does not own child process lifecycle or expose transport records.
