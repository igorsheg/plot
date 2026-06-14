# Local control connections require token auth

Plot will require token authentication for Local Plot Server control connections, even when bound to localhost. The local server stores a persistent per-user bearer token with user-only file permissions; CLI and TUI clients read it automatically, while browser launches use a safe handoff such as a short-lived ticket or URL fragment. Binding to `127.0.0.1` is a network exposure limit, not sufficient authentication for a browser control plane.
