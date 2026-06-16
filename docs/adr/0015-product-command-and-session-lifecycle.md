# Product command and session lifecycle

Plot's product surface is project sessions plus one machine-local fleet daemon. Commands must describe user intent, not implementation seams.

## Invariants

1. **One daemon owns the fleet** — the Local Plot Server is user-scoped and owns the in-memory registry of live Plot Sessions. It is not one process per repository and not one process per TUI.
2. **A Plot Session is project/workflow-scoped** — the default session identity is derived from the current working directory and workflow path. Running Plot in three repositories creates three distinct sessions in the same daemon.
3. **`plot` means work here** — the bare command starts or attaches the current project/workflow session and opens the TUI.
4. **Ctrl-C closes the session** — exiting the TUI closes the attached Plot Session immediately, interrupting active Agent Runs and flushing Session History. Detach-and-keep-running is not the default product behavior.
5. **The daemon exits when idle** — after a command closes its session, if no live sessions remain, the Local Plot Server is stopped. Live means any session not in `stopped` or `error`.
6. **`plot web` is an observer/controller panel** — web opens the fleet dashboard, prints its URL, and holds the CLI until Ctrl-C. It must not create a session by itself.
7. **`plot run` is oneshot** — run creates a oneshot session, waits for terminal completion, records history, and then participates in idle daemon cleanup.
8. **`plot stop` is explicit lifecycle control** — `plot stop` closes the current project/workflow session. `plot stop --all` stops the daemon and all hosted sessions.
9. **Internal server commands are not product commands** — daemon transport entrypoints may exist behind underscored/internal commands, but users should not need `serve`, `service`, or `tui` vocabulary.
10. **No compatibility aliases** — retired product commands should be removed rather than kept as shims. Broken command invocations are preferable to preserving an unclear lifecycle model.

## Public command surface

```txt
plot              open/attach this project session in TUI
plot web          open the fleet dashboard and hold until Ctrl-C
plot run          run this workflow once
plot stop         close this project session
plot stop --all   stop all Plot sessions and the daemon
```

Provider/auth/docs/model commands may remain because they are not runtime lifecycle verbs.

## Internal command surface

`plot _serve` is the daemon child entrypoint used by autostart. `plot _serve stdio` is the protocol test/SDK transport entrypoint. These are implementation details, not product documentation.

## Non-goals

- Do not make each repository own a daemon.
- Do not keep sessions alive on TUI Ctrl-C by default.
- Do not require users to understand daemon process lifecycle to use Plot locally.
