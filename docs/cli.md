# CLI Reference

The npm package is `plot-ai`; its binary is `plot`.

```bash
npx plot-ai --help
# installed form:
plot --help
```

`plot` coordinates three boundaries:

- human commands and dashboards;
- shared run-registry IPC for process lifecycle;
- the versioned Session JSONL protocol for runtime control and events.

## Command map

```txt
plot [workflow options]                  open terminal dashboard (same as plot open)
plot open [workflow] [--web]            start a managed run and dashboard
plot run [workflow]                     run current work without a dashboard
plot runs [list|show|logs|stop|clean]   inspect shared managed runs
plot events [stream|wait]               consume gapless RuntimeEvent records
plot api [schema|ping|snapshot]         inspect/call Session protocol
plot auth [status|login|logout]         provider credentials
plot models [search]                    provider/model catalog
plot config [list|get|set]              project/global defaults
plot init [workflow]                    create one-shot starter Workflow
plot doctor [workflow]                  validate Workflow and auth readiness
plot docs [topic]                       print bundled documentation
plot serve api [workflow]               HTTP gateway or stdio Session protocol
plot serve registry                     run shared registry daemon
```

`plot`, `plot runs`, `plot auth`, and `plot config` default to `open`, `runs list`, `auth status`, and `config list` respectively.

## Start commands

```bash
plot
plot open [workflow]
plot open [workflow] --web [--open]
plot run [workflow]
```

- Terminal `open` starts a managed child Session through the shared run registry and renders live events. Exiting the TUI stops that run.
- Web `open` starts the HTTP gateway/browser UI. The UI can create and watch managed runs. Without `--open`, the terminal landing screen accepts `o` to open and `q` to stop the gateway.
- `run` starts an in-process Session, waits for current work to settle according to Source reconciliation, prints the final assistant message for human output, and exits.

The Workflow defaults to `WORKFLOW.md` under `--cwd`.

## Workflow and Session options

These options are accepted by the root command, `open`, `run`, and stdio `serve api` where applicable:

| Option                 | Meaning                                                                                                                     |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `[workflow]`           | Positional Workflow path.                                                                                                   |
| `--workflow <path>`    | Explicit Workflow path; overrides the positional value.                                                                     |
| `--session-id <id>`    | 1–128 letters, digits, dots, underscores, or hyphens, beginning with a letter or digit. Existing Session logs are rejected. |
| `--cwd <path>`         | Project root for Workflow execution and Plot state.                                                                         |
| `--plot-dir <path>`    | Project state directory. Default: `<cwd>/.plot`.                                                                            |
| `--agent-dir <path>`   | Agent auth/model directory. Default: `~/.plot/agent`.                                                                       |
| `--session-dir <path>` | Session JSONL directory. Default: `<plot-dir>/sessions`.                                                                    |
| `--log-level <level>`  | `debug`, `info`, `warn`, or `error`. Default: `warn`.                                                                       |

Runtime overrides:

- `--request-queue-capacity <count>`
- `--event-capacity <count>`
- `--event-buffer-capacity <count>`
- `--tick-interval-ms <ms>`
- `--max-run-duration-ms <ms>`

Agent overrides:

- `--provider <id>`
- `--model <id>` or `--model <provider>/<model>`
- `--api-key <key>`
- `--thinking <off|minimal|low|medium|high|xhigh>`
- `--tools <comma-separated allowlist>`
- `--exclude-tools <comma-separated list>`
- `--no-tools`
- `--no-builtin-tools`
- `--allow-project-config`

Resource overrides:

- repeatable `--skill <path>`
- repeatable `--prompt-template <path>`
- `--no-skills`
- `--no-prompt-templates`
- `--no-context-files`
- `--system-prompt <text>`
- repeatable `--append-system-prompt <text>`

## Run registry

```bash
plot runs [--json]
plot runs list [--json]
plot runs show <run-id> [--json]
plot runs logs <run-id> [--after <sequence>]
plot runs stop <run-id> [--json]
plot runs clean [--json]
```

A run id may be complete or any unique prefix from `plot runs list`.

- `list`: catalog all managed runs.
- `show`: one catalog record.
- `logs`: when a Session file is known, replay durable records after the sequence and then follow the live tail as JSONL; otherwise follow the live tail only.
- `stop`: stop a managed child.
- `clean`: remove stopped/errored catalog records from the registry. It does not delete Session JSONL or Agent Transcript files.

Registry options are `--cwd <path>` and `--registry-dir <path>`. `--json` prints raw registry IPC responses instead of human tables/messages.

## Events

```bash
plot events stream <run-id> [--after <sequence>]
plot events wait <run-id> --type <event-type> [filters]
```

When the run catalog has a Session file, both commands use a gapless stream: subscribe to the child tail, replay durable Session events after the requested sequence, suppress durable/live duplicates, then continue live. Before a Session file is known, registry streaming falls back to the live child tail; unlike the web event endpoint, the CLI does not reject that live-only case.

`stream` writes Session protocol records as JSONL.

`wait` scans replay and then live records, writes the first match as pretty JSON, and exits. Required `--type` is one of:

- Session lifecycle: `session_started`, `session_shutdown`
- Control cycle: `tick_started`, `tick_completed`
- Work projection: `work_observed`, `work_removed`, `wake_scheduled`
- Attempt lifecycle: `attempt_started`, `attempt_completed`
- Relayed Agent Session record: `agent_event`

Every RuntimeEvent has `sessionId`, monotonic `sequence`, and ISO `timestamp`. Session records have `kind: "session_event"` and an `event` from the list above. Relayed records have `kind: "agent_event"`, `sourceId`, Agent Run `runId`, `workKey`, and opaque provider/agent `event` data.

Work statuses in `work_observed` are `pending`, `waiting`, `running`, `blocked`, or `draining`. Attempt completion statuses are `succeeded`, `failed`, `interrupted`, or `timed_out`.

`wait` filters:

- `--after <non-negative sequence>`; default `0`
- `--timeout-ms <ms>`; default no timeout
- `--work-key <key>`
- `--run-id <Agent Run id>`
- `--source-id <Source id>`
- `--status <work or completion status>`
- `--tick-id <tick id>`

The positional `<run-id>` selects the managed Plot run. `--run-id` filters the Agent Run inside events; they are different ids.

## Public Session protocol

```bash
plot api schema
plot api ping <run-id>
plot api snapshot <run-id>
plot serve api WORKFLOW.md --stdio
```

`api schema` prints the exact bundled schema. `api ping` and `api snapshot` call live managed runs. For arbitrary methods, own a stdio process and exchange newline-delimited JSON.

Current protocol: `plot.session.v5`, schema version `1`, transport `jsonl`.

Request envelope:

```json
{
	"protocol": "plot.session.v5",
	"kind": "request",
	"id": "client-unique-id",
	"method": "session.tick",
	"params": {}
}
```

Output records are `welcome`, `event`, and `response`. Successful responses include `ok: true`, method-specific `data`, and usually a `lastSequence` durability fence. Errors include `ok: false` and `error.code`, `error.message`, and optional `error.details`.

Methods:

| Method                    | Params                                                                      | Result/purpose                                                      |
| ------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `ping`                    | none                                                                        | `{ pong: true }`                                                    |
| `session.start`           | none                                                                        | Start Session event publication.                                    |
| `session.shutdown`        | none                                                                        | Request host/runtime shutdown.                                      |
| `session.snapshot`        | none                                                                        | JSON-safe live runtime state. Not a durable dashboard checkpoint.   |
| `session.tick`            | none                                                                        | Run one `discover -> reconcile -> act` cycle and return its result. |
| `session.dispatch.pause`  | none                                                                        | Pause new dispatch while preserving state.                          |
| `session.dispatch.resume` | none                                                                        | Resume dispatch.                                                    |
| `scheduler.snapshot`      | none                                                                        | Current scheduler work/runs/wakes/diagnostics snapshot.             |
| `work.list`               | none                                                                        | Current scheduler Work Records.                                     |
| `work.get`                | `{ "workKey": "..." }`                                                      | One current Work Record, if present.                                |
| `attempt.list`            | none                                                                        | Current running Agent Runs.                                         |
| `agent.interrupt`         | `{ "runId": "...", "workKey"?: "..." }`                                     | Interrupt a matching Agent Run.                                     |
| `operator.observe`        | `{ sourceId, workKey, actionId, actionLabel, comment?, clientId?, actor? }` | Record controller input for Source reconciliation.                  |

Boundary error codes are `parse_error`, `invalid_request`, `payload_too_large`, `request_queue_full`, `session_closed`, and `internal_error`.

## Auth, models, and settings

```bash
plot auth
plot auth status
plot auth login [provider]
plot auth logout [provider]
plot models [search]
```

Auth/model path options: `--cwd`, `--plot-dir`, `--agent-dir`.

```bash
plot config
plot config list [--global]
plot config get defaultProvider [--global]
plot config set defaultProvider openai-codex [--global]
```

Supported keys are `defaultProvider`, `defaultModel`, and `defaultThinkingLevel`. Project settings live in `.plot/settings.json`; `--global` uses `~/.plot/settings.json` with default paths.

## Setup and validation

```bash
plot init [workflow] [--cwd <path>] [--force]
plot doctor [workflow] [--cwd <path>] [--plot-dir <path>] [--agent-dir <path>]
```

`init` writes a one-shot Workflow and refuses to overwrite unless `--force` is present. `doctor` parses the Workflow and checks that at least one provider is authenticated; it does not load the extension or verify a selected model.

## Servers

```bash
plot serve api [workflow] --stdio
plot serve api [workflow] [--http] [--host 127.0.0.1] [--port 0] [--open]
plot serve registry [--cwd <path>] [--registry-dir <path>]
```

- `--stdio`: one Workflow Session over JSONL stdin/stdout. Protocol output owns stdout; diagnostics go to stderr.
- HTTP is the default when `--stdio` is absent. It serves the browser assets, run API, and SSE.
- `serve registry` runs the shared local process/catalog daemon.

## Bundled docs

```bash
plot docs                         # index
plot docs quickstart
plot docs workflows
plot docs extensions
plot docs tui
plot docs web
plot docs cli
plot docs extension-prompt       # LLM-ready SDK guide + user-goal placeholder
```

Help routing:

```bash
plot --help
plot help <command> [subcommand]
plot <command> [subcommand] --help
```
