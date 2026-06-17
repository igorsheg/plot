# Web

The web dashboard is the localhost control plane for the Local Plot Server roster.

```bash
plot web
```

`plot web` uses the shared machine-local Plot Server daemon when live sessions exist, starts a foreground localhost web gateway for the bundled web app, opens the browser, prints the URL, and holds the terminal until Ctrl-C. The browser receives the gateway WebSocket handoff through a URL fragment, stores it in session storage, and scrubs the visible URL. The gateway proxies to the daemon; the daemon does not serve web assets.

## What it shows

The web has two levels:

1. **Fleet** — every Plot Session known to the Local Plot Server, sorted by Needs You, errors, active work, paused sessions, idle/watch sessions, and recent stopped oneshots.
2. **Session detail** — the same per-session Process Table projection that the TUI renders.

If only one Plot Session is reachable, the web opens directly into session detail unless you pass `--fleet`.

## Commands

```bash
plot web                  # open the fleet/detail dashboard
plot web --session-id ID  # open an existing session directly
plot web --role observer  # watch without controller actions
plot web --fleet          # force the fleet view
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
- Pressing Ctrl-C in `plot web` stops only the web gateway.
- `plot tui` owns its session: quitting or Ctrl-C closes that session, and the daemon exits if no live sessions remain.
- Controller actions such as pause, resume, Reconcile now, interrupt Agent Run, close session, and Source-declared Operator Actions go through the explicit control protocol.
- Operator Actions record Operator Observations in Session History. The web never calls Source code directly.
- Session History is project-local and authoritative for control-plane state, not extension domain state. Extensions decide what work exists from their own durable source of truth.
- pi-mono Agent Transcripts remain separate from Plot Session History.

Remote exposure, TLS, and non-local authentication are out of scope for the local web control plane.
