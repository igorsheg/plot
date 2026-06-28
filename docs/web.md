# Web dashboard

```bash
plot web
```

The web dashboard opens a local browser UI over the shared Plot run registry.
If `plot tui` or `plot api --http` already owns the registry, `plot web` attaches to it. Otherwise it starts one.

HTTP API surface:

- `GET /api/runs`
- `POST /api/runs`
- `DELETE /api/runs/:id`
- `GET /api/runs/:id/events`
- `GET /api/runs/:id/projection`

Use `plot api --http` when you want the API without automatically opening the browser.
