# Local Plot Server autostart

Plot will use a per-user Local Plot Server for normal local operation. CLI, TUI, web, and automation entrypoints should use or autostart this server so Plot Sessions from multiple projects appear in one Session Roster. The server prefers a stable localhost port and falls back to an ephemeral port, with user-level connection metadata for discovery; project-local `.plot/` remains workflow and session state, not server identity.
