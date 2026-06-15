# Normal entrypoints register with the Plot Server

Plot will make normal entrypoints such as `plot tui` and web-created sessions register their Plot Sessions with the local Plot Server when available. The Session Roster is the Plot Server's registry, not ad hoc process or socket discovery, but the ergonomics should match user expectations: sessions opened from the CLI, TUI, web, or automation appear in the same fleet view.
