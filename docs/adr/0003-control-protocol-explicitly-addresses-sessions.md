# Control protocol explicitly addresses sessions

Plot will break the current implicit single-session `plot.v1` wire shape before it has external consumers. All transports will speak one connection-scoped control protocol: a client connection receives a server welcome, attaches to Plot Sessions explicitly, and sends session commands with `sessionId`. Stdio may auto-open one session for ergonomics, but the protocol itself has no hidden current session; detach and close-session are separate operations.
