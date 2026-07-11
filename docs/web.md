# Web Dashboard and HTTP API

```bash
plot open WORKFLOW.md --web
# API/browser gateway without the open command:
plot serve api WORKFLOW.md --http
```

HTTP is the default for `plot serve api` when `--stdio` is absent. The server binds to `127.0.0.1` and a random free port unless `--host` or `--port` is supplied.

`plot open --web` prints a terminal landing screen. Press `o` to launch the browser and `q` to stop the gateway, or pass `--open`.

## Runtime model

- The shared run registry owns catalog metadata and child process lifecycle.
- Each child Session owns live scheduler state and an append-only RuntimeEvent JSONL file.
- `@plot/projection` is a pure reducer over canonical Session events.
- The web loads a durable projection baseline, then advances it with a gapless SSE continuation.
- The gateway subscribes to the live tail before replay, replays durable events after the requested frontier, and suppresses duplicate sequences at the handoff.
- Runtime snapshots are control-plane inspection data, not dashboard checkpoints.

Runs without a Session event file fail durable projection/continuation requests rather than silently degrading to a lossy live-only view.

## Route map

```txt
GET /api/health
GET /api/runs
GET /api/runs/events
POST /api/runs
DELETE /api/runs/:id
GET /api/runs/:id/events
GET /api/runs/:id/session-events
GET /api/runs/:id/projection
GET /api/runs/:id/attempts/:runId/transcript
POST /api/runs/:id/source-actions
DELETE /api/runs/:id/source-actions/:actionRunId
POST /api/runs/:id/observations
```

All non-SSE responses are JSON unless an error is returned as plain text.

### `GET /api/health`

Returns gateway/registry readiness:

```json
{ "ok": true, "socketPath": "/path/to/runRegistry.sock" }
```

### `GET /api/runs`

Returns the run-registry catalog as an array. Records include process status, cwd, label, Workflow/Session identity, Session file path when known, timestamps, and last observed sequence.

### `GET /api/runs/events`

Catalog SSE. The stream emits `event: plot` frames whose data is:

```json
{ "kind": "runs", "runs": [] }
```

The gateway polls the catalog every second and emits only changes. Errors arrive as `{ "kind": "error", "error": "..." }` frames.

### `POST /api/runs`

Starts a managed run. JSON is optional:

```json
{
	"cwd": "/absolute/project",
	"workflowPath": "WORKFLOW.md",
	"label": "review queue"
}
```

Omitted fields use gateway startup defaults. If `content-type` is JSON, the body must be an object and supplied fields must be non-empty strings.

### `DELETE /api/runs/:id`

Stops one managed child run and returns the updated registry response.

### `GET /api/runs/:id/session-events?after=<sequence>`

Returns durable Session events strictly after the non-negative sequence:

```json
{
	"records": [
		{ "kind": "event", "sequence": 42, "event": { "type": "tick_completed" } }
	],
	"truncated": false
}
```

A page contains at most 20,000 records. When `truncated` is true, request again after the final returned sequence.

### `GET /api/runs/:id/events?after=<sequence>`

Gapless RuntimeEvent SSE. `Last-Event-ID` is also accepted; the gateway resumes after the maximum valid value from the header and query.

The stream emits `event: plot`, an SSE `id` equal to RuntimeEvent sequence, and JSON data containing a Session protocol event record. Durable/live duplicate sequences are suppressed.

### `GET /api/runs/:id/projection`

Replays the Session JSONL file through the pure dashboard reducer and returns:

```json
{ "projection": {} }
```

The serialized projection's frontier is the highest durable RuntimeEvent sequence reduced. Clients should then connect to `/events?after=<frontier>`.

### `GET /api/runs/:id/attempts/:runId/transcript`

Returns display entries for one Agent Run transcript. The gateway derives the transcript file from the event-reduced projection; clients never supply filesystem paths.

### `POST /api/runs/:id/source-actions`

Starts an extension setup action and returns its process-local `actionRunId`:

```json
{
	"sourceId": "extension:wix-jira",
	"requirementId": "wix-mcp",
	"actionId": "connect"
}
```

Progress, URL-open effects, completion, and failure arrive through RuntimeEvents. OAuth URLs are live-only effects and are not written to Session history.

### `DELETE /api/runs/:id/source-actions/:actionRunId`

Cancels one in-flight Source setup action. The action receives an aborted signal and a `source_action_cancelled` event follows.

### `POST /api/runs/:id/observations`

Records a controller choice for Source reconciliation:

```json
{
	"sourceId": "extension:release",
	"workKey": "extension:[...]",
	"actionId": "approve",
	"actionLabel": "Approve",
	"comment": "verified by release manager",
	"clientId": "web-console"
}
```

`sourceId`, `workKey`, `actionId`, and `actionLabel` are required non-empty strings. `comment` and `clientId` are optional strings. The response acknowledges control-plane acceptance; the resulting state change arrives later through RuntimeEvents after Source reconciliation.

## Browser ownership

The web UI consumes run catalog state, durable projections, gapless events, and transcript endpoints. It does not read private scheduler queues or merge `session.snapshot` into a durable projection.

Operator controls are generic Plot actions. Source-specific concepts such as GitHub reviews, CI severity, or release policy stay in Work Item display/context, extension tools, and agent prose.
