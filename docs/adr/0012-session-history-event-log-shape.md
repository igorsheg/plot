# Session History event log shape

Plot Session History will be an append-only JSONL log of domain events, not transport/protocol records. Each event carries `sessionId`, `epoch`, a monotonic session-local `sequence`, `timestamp`, `type`, and payload; `sessionId` is the durable identity and `epoch` identifies one live incarnation. On restart, Plot appends recovery events that mark Agent Runs active in the previous epoch as interrupted, then lets normal `tick -> reconcile -> act` decide whether work is retried.
