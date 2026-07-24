# Terminal dashboard

```bash
plot WORKFLOW.md
```

The terminal dashboard is an attached operator view of one durable Session.

## Lifecycle

- If the Workflow has no Active Session, Plot starts one.
- Otherwise Plot attaches to the existing Session.
- Durable Session History reconstructs the current projection before live continuation.
- `q` or Ctrl-C opens a stop confirmation. `Enter`, `q`, `y`, or Ctrl-C again confirms.
- `d` explicitly detaches and leaves the Session running. Plot prints a copyable `plot stop` command and warns that token use may continue.
- `Esc` or `n` cancels the stop confirmation.
- Terminal loss cannot express confirmed intent, so the durable Session remains active.
- `plot stop WORKFLOW.md` and the Web Console Stop action remain reliable shutdown paths.

This ownership rule allows intentional background operation without making continued token use the easy default.

## Views

The Process Table shows Source readiness, Work Items, current or latest Agent Runs, scheduled wakes, and diagnostics. Detail views expose Agent Transcript activity and Source-declared Operator Actions.

Source requirements that need human work appear as `Needs You`. Their actions run inside the Session, stream progress, and may open authorization URLs.

## Controls

The dashboard displays its current key map in the footer. Core controls include:

- `q` or Ctrl-C — confirm and stop
- `d` — explicitly detach
- `t` — request a reconciliation tick
- `b` — toggle debug projection details
- `c` — toggle runtime configuration
- arrow keys or `j`/`k` — move selection
- `Enter` — inspect selected work
- `s` — invoke an available Source setup action
- `Esc` — return to the Process Table or cancel stop confirmation

The TUI consumes Plot concepts and direct RuntimeEvents through the internal Session Manager. It does not own child process lifecycle or expose transport records.

Related active Work Items with a shared Subject render as one Subject row with
indented Work Item rows. Structured Subject presentation and progress come
from the Source and are never inferred as scheduler dependencies by the TUI.
