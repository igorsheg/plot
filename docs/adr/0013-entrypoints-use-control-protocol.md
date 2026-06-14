# Entrypoints use the control protocol

Plot product entrypoints such as `plot tui`, `plot run`, and `plot web` will use the Local Plot Server and explicit control protocol by default. This keeps the Session Roster, authorization, attach/detach semantics, projections, and lifecycle behavior on one path instead of splitting local TUI/run behavior from web behavior. In-process session hosts may remain for tests or explicit escape hatches, but they are not the normal runtime path.
