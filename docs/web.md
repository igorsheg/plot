# Web Dashboard

```bash
plot web
```

Opens a local browser UI over the shared Plot run registry daemon. If the daemon is not running, `plot web` starts it.

The web dashboard can watch runs started by `plot tui`, `plot web`, or the HTTP API.

## HTTP API

```txt
GET    /api/runs
POST   /api/runs
DELETE /api/runs/:id
GET    /api/runs/:id/events
GET    /api/runs/:id/projection
POST   /api/runs/:id/observations
```

`POST /api/runs/:id/observations` records an Operator Observation for a
blocked Work Item: `{ sourceId, workKey, actionId, actionLabel, comment? }`.
The session's Source reconciles with it on the next tick.

`GET /api/runs/:id/projection` serves live sessions from a snapshot. For
stopped sessions it replays the durable Session History
(`<runRegistryDir>/history/<runId>.jsonl`, written by the registry daemon)
through the shared projection reducer and marks the response `replayed: true`,
so the web shows a post-mortem board instead of an empty state.

Use `plot api --http` when you want the API without opening a browser.
