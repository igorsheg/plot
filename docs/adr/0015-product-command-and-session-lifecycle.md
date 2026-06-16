# Product command and session lifecycle

Plot's product surface is foreground shell commands plus a small machine-local roster daemon. Commands must describe which plane they operate.

## Invariants

1. **TUI owns its session lifetime** — `plot tui` is a foreground shell command. Quitting it or pressing Ctrl-C closes the Plot Session and interrupts active agent work.
2. **The daemon owns roster/protocol mechanics** — the Local Plot Server hosts live runtimes for control/web visibility, writes Session History/catalog entries, and performs bounded shutdown.
3. **No idle daemon after the last killed session** — when a controller closes the last live session, the daemon shuts down.
4. **Live registry contains only live runtimes** — closing a session moves it through `stopping`, records terminal history, then unregisters it. Stopped sessions are catalog/history records, not live runtime objects.
5. **`plot web` is a web gateway** — it serves bundled web assets from a foreground localhost gateway and proxies WebSockets to the daemon. The daemon does not serve web assets, and browser tabs do not own session lifetime.
6. **`plot run` is oneshot** — it creates a connection-lifetime oneshot session, waits for terminal completion, records history, then exits.
7. **`plot stop --all` is emergency lifecycle control** — it asks the daemon to close all sessions and shut down, then falls back to process-group termination.
8. **Internal server commands are not product commands** — daemon transport entrypoints may exist behind underscored/internal commands, but users should not need `serve` or `_serve` vocabulary.
9. **No compatibility aliases** — retired lifecycle commands should be removed rather than kept as shims. Broken command invocations are preferable to preserving an unclear lifecycle model.

## Public command surface

```txt
plot tui          open this project session in TUI; Ctrl-C closes it
plot web          start the web gateway and open the fleet dashboard
plot run          run this workflow once
plot stop --all   stop all Plot sessions and the daemon
```

Provider/auth/docs/model commands may remain because they are not runtime lifecycle verbs. A targeted `plot stop` may remain as an escape hatch, but it is not the normal TUI lifecycle path.

## Internal command surface

`plot _serve` is the daemon child entrypoint used by autostart. `plot _serve stdio` is the protocol test/SDK transport entrypoint. These are implementation details, not product documentation.

## Non-goals

- Do not make each repository own a daemon.
- Do not keep stopped sessions in the live registry.
- Do not serve the web app from the daemon.
