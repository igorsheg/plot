# Fleet Web Console

```bash
plot web
```

The Web Console is a fleet-wide operator surface. It lists Active and historical Sessions, reconstructs projections from Session History, follows live changes, exposes Agent Transcripts, and submits Operator Actions.

Unlike the terminal dashboard, `plot web` is not scoped to one Workflow and does not silently start one. Start from a terminal with `plot start WORKFLOW.md` or select a configured Workflow in the console when that UI is available.

## Lifecycle

The Web Console and Sessions have independent lifecycles:

- closing the browser does not stop Sessions;
- stopping the Web Console gateway does not stop Sessions;
- stopping a Session is an explicit operator action;
- reopening the console reconstructs every Session from the Session Manager catalog and durable history.

## Internal transport

The browser uses same-version local HTTP and SSE routes served by Plot. They are implementation details, not a public API or compatibility promise. Custom automation must use the supported Extension SDK and domain integrations rather than scraping browser routes or consuming raw RuntimeEvents.

The gateway binds to `127.0.0.1` and a random free port by default. `plot web --host` and `plot web --port` exist for development and supervised local deployments. Exposing the gateway beyond a trusted local environment requires an external security layer.
