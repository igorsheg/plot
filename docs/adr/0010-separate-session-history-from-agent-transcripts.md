# Separate Session History from Agent Transcripts

Plot will persist its own append-only Session History for control-plane events such as ticks, Source observations, Work Item state, Agent Run lifecycle, Operator Observations, diagnostics, and roster metadata. This adopts pi-mono's append-only durability pattern without co-owning pi-mono storage: pi-mono remains responsible for Agent Transcript persistence, and Plot may reference transcript identifiers or paths but must not mutate or mingle with those transcript files.
