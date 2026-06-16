# Entrypoints use the control protocol

Superseded by [0015 Product command and session lifecycle](0015-product-command-and-session-lifecycle.md) for command names and daemon ownership.

Plot product entrypoints such as `plot tui`, `plot run`, and `plot web` will use the Local Plot Server and explicit control protocol by default. `plot web` owns a foreground Local Plot Server process, opens the browser, and holds until Ctrl-C instead of daemonizing. This keeps the Session Roster, authorization, attach/detach semantics, projections, and lifecycle behavior on one path instead of splitting local TUI/run behavior from web behavior. In-process session hosts may remain for tests or explicit escape hatches, but they are not the normal runtime path.
