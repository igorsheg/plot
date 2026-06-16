# Product command and session lifecycle

Plot's product surface is one machine-local fleet daemon plus separate clients. Commands must describe which plane they operate.

## Invariants

1. **One daemon owns live runtime state** — the Local Plot Server owns the in-memory registry of live Plot Sessions, starts/stops sessions, writes Session History/catalog entries, and performs shutdown.
2. **Clients do not own cleanup** — TUI and browser clients attach/detach. They do not stop sessions or stop the daemon merely because a view exited.
3. **Live registry contains only live runtimes** — closing a session moves it through `stopping`, records terminal history, then unregisters it. Stopped sessions are catalog/history records, not live runtime objects.
4. **`plot tui` is a terminal client** — it opens or attaches the current project/workflow session and detaches on quit. Use `plot stop` for explicit session close.
5. **`plot web` is a web gateway** — it serves bundled web assets from a foreground localhost gateway and proxies WebSockets to the daemon. The daemon does not serve web assets.
6. **`plot run` is oneshot** — it creates a oneshot session, waits for terminal completion, records history, then detaches; the daemon remains a daemon.
7. **`plot stop` is explicit lifecycle control** — `plot stop` closes the current project/workflow session. `plot stop --all` asks the daemon to close all sessions and shut down, then falls back to process-group termination.
8. **Internal server commands are not product commands** — daemon transport entrypoints may exist behind underscored/internal commands, but users should not need `serve` or `_serve` vocabulary.
9. **No compatibility aliases** — retired lifecycle commands should be removed rather than kept as shims. Broken command invocations are preferable to preserving an unclear lifecycle model.

## Public command surface

```txt
plot tui          open/attach this project session in TUI
plot web          start the web gateway and open the fleet dashboard
plot run          run this workflow once
plot stop         close this project session
plot stop --all   stop all Plot sessions and the daemon
```

Provider/auth/docs/model commands may remain because they are not runtime lifecycle verbs.

## Internal command surface

`plot _serve` is the daemon child entrypoint used by autostart. `plot _serve stdio` is the protocol test/SDK transport entrypoint. These are implementation details, not product documentation.

## Non-goals

- Do not make each repository own a daemon.
- Do not keep stopped sessions in the live registry.
- Do not serve the web app from the daemon.
