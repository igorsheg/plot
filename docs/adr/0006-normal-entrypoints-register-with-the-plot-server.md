# Normal entrypoints register with the Plot Server

Superseded by [0015 Product command and session lifecycle](0015-product-command-and-session-lifecycle.md) for command names and daemon ownership.

Plot will make normal entrypoints such as `plot tui` and web-created sessions register their Plot Sessions with the local Plot Server when available. The Session Roster is the Plot Server's registry, not ad hoc process or socket discovery, but the ergonomics should match user expectations: sessions opened from the CLI, TUI, web, or automation appear in the same fleet view.
