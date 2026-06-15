# Web

The web dashboard is the localhost control plane for the Local Plot Server roster.

```bash
plot web
```

`plot web` starts the machine-local Plot Server in the foreground, opens the browser to the bundled web app, and holds the terminal until you press Ctrl-C. The browser receives the local control token through a URL fragment, stores the WebSocket handoff in session storage, and scrubs the visible URL. Binding to localhost is still only an exposure limit; token auth remains required.

## What it shows

The web has two levels:

1. **Fleet** — every Plot Session known to the Local Plot Server, sorted by Needs You, errors, active work, paused sessions, idle/watch sessions, and recent stopped oneshots.
2. **Session detail** — the same per-session Process Table projection that the TUI renders.

If only one Plot Session is reachable, the web opens directly into session detail unless you pass `--fleet`.

## Commands

```bash
plot web                  # start foreground server and open fleet/detail
plot web --session-id ID  # open an existing session directly
plot web --role observer  # watch without controller actions
plot web --no-open        # print URL, do not open browser; still hold until Ctrl-C
```

The web does not create workflows in this slice. Start sessions with:

```bash
plot tui --workflow WORKFLOW.md
plot run --workflow WORKFLOW.md
```

Those sessions appear in the web roster.

## Lifecycle semantics

- Closing the browser tab detaches the browser; it does not close the Plot Session.
- Pressing Ctrl-C in `plot web` stops the foreground Local Plot Server process.
- Controller actions such as pause, resume, Reconcile now, interrupt Agent Run, close session, and Source-declared Operator Actions go through the explicit control protocol.
- Operator Actions record Operator Observations in Session History. The web never calls Source code directly.
- Session History is project-local and authoritative for control-plane state; pi-mono Agent Transcripts remain separate.

Remote exposure, TLS, and non-local authentication are out of scope for the local web control plane.
