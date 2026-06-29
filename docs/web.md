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
```

Use `plot api --http` when you want the API without opening a browser.
