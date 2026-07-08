# Web Dashboard

```bash
plot open --web
```

Starts the local browser UI over the shared Plot run registry daemon and prints a terminal landing screen with the URL. Press `o` to open the browser, or `q` to stop the web server.

The web dashboard can watch runs started by `plot open`, `plot open --web`, or the HTTP API.

## Ownership model

Plot's web stack follows the same boundary shape as the pi orchestrator:

- The run registry owns only catalog metadata and process lifecycle: run id, status, cwd, labels, session identity, session file path, timestamps, and last observed sequence.
- The live runtime is the child session process. Runtime snapshots are control-plane state and are not dashboard checkpoints.
- Live events are forwarded from the child to subscribers as an ordered tail, but web-facing run event streams are gapless continuations: the gateway first replays durable session events after the requested sequence, then switches to live forwarding.
- Durable session data is owned by the session process as a JSONL event log; the registry stores only the path.
- The gateway adapts catalog records, durable session files, and live event tails into HTTP/SSE. It suppresses duplicate event sequences at the durable/live boundary.
- `@plot/projection` is a pure reducer over session events. A durable baseline frontier is the highest durable event sequence reduced from the session log; while connected, consumers may advance that frontier with live-only events that are intentionally not replayable.
- The web consumes a projection baseline plus a gapless event continuation; it does not merge runtime snapshots with UI state.

No compatibility layer should keep the old snapshot-as-projection contract alive.

The terminal TUI is intentionally live-only: it starts a new run and renders events observed during that process lifetime. Durable attach/resume is a web/gateway contract, not a TUI recovery mechanism.

## HTTP API

```txt
GET    /api/runs
POST   /api/runs
DELETE /api/runs/:id
GET    /api/runs/:id/events
GET    /api/runs/:id/session-events
GET    /api/runs/:id/projection
GET    /api/runs/:id/attempts/:runId/transcript
POST   /api/runs/:id/observations
```

`GET /api/runs/:id/attempts/:runId/transcript` serves the Agent Transcript of
one Agent Run as display entries. The transcript file path is derived
server-side from the event-reduced projection; clients never name files.

`POST /api/runs/:id/observations` records an Operator Observation for a
blocked Work Item: `{ sourceId, workKey, actionId, actionLabel, comment? }`.
The session's Source reconciles with it on the next tick. The response is a
control-plane acknowledgement; projection updates arrive as session events.

`GET /api/runs/:id/session-events?after=<sequence>` serves durable session
event log records after that sequence, capped at 20,000 with `truncated` when
more remain.

`GET /api/runs/:id/events?after=<sequence>` serves a gapless SSE continuation.
The gateway subscribes to the live child tail, replays durable session event
records after `sequence`, suppresses duplicate sequence numbers, then forwards
the live tail. Runs without a `sessionFile` fail rather than degrading to a
lossy live-only stream.

`GET /api/runs/:id/projection` serves only an event-reduced dashboard
projection. It is built from the session-owned event log named by the run
catalog record, and its `frontier` is the highest durable sequence reduced.

Use `plot serve api --http` when you want the API without opening a browser.
