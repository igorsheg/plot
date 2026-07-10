# CLI

`plot` is the command-line entry point for opening dashboards, running workflows, managing provider auth, inspecting runs, and calling the public session protocol.

The CLI is the stable automation surface. Human commands, JSON output, `plot api`, `plot events`, `plot serve api --stdio`, and the web gateway all speak the same session protocol records.

## Main commands

```bash
plot
plot open [workflow]
plot open [workflow] --web
plot run [workflow]
plot runs
plot api schema
plot events wait <run-id> --type tick_completed
plot auth
plot models [search]
plot init [workflow]
plot doctor [workflow]
```

- `plot` opens the terminal dashboard for `WORKFLOW.md`.
- `plot open [workflow]` opens the terminal dashboard for a workflow.
- `plot open [workflow] --web` opens the browser dashboard.
- `plot run [workflow]` runs one workflow pass without a dashboard.
- `plot runs` lists shared registry runs.
- `plot api schema` prints the public session protocol schema.
- `plot events wait <run-id> --type <event>` blocks until a live run emits an event.
- `plot auth` shows provider authentication status.
- `plot models` lists provider/model ids available to Plot auth.
- `plot init` creates a starter workflow.
- `plot doctor` checks workflow parsing and provider auth readiness.

## Run commands

```bash
plot runs [--json]
plot runs list [--json]
plot runs show <run-id> [--json]
plot runs logs <run-id> [--after <sequence>]
plot runs stop <run-id> [--json]
plot runs clean [--json]
```

`<run-id>` accepts a full run id or any unique prefix shown by `plot runs`.

Common registry options:

- `--cwd <path>`: project root used by registry operations.
- `--registry-dir <path>`: alternate run registry state directory.
- `--json`: print raw IPC responses for commands that return a single response.

## API commands

```bash
plot api schema
plot api ping <run-id>
plot api snapshot <run-id>
```

`plot api` is for deterministic clients and agents. It prints JSON protocol records and accepts unique run id prefixes anywhere `<run-id>` is shown.

- `schema`: print the bundled session protocol schema, including protocol version and method names.
- `ping`: send `ping` to a live run.
- `snapshot`: send `session.snapshot` to a live run and print the response.

Current public session protocol methods:

- `ping`
- `session.start`
- `session.shutdown`
- `session.snapshot`
- `session.tick`
- `session.dispatch.pause`
- `session.dispatch.resume`
- `agent.interrupt`
- `operator.observe`

## Event commands

```bash
plot events stream <run-id> [--after <sequence>]
plot events wait <run-id> --type <event-type> [--after <sequence>] [--timeout-ms <ms>]
```

`events stream` prints live protocol records as JSONL. `events wait` prints the first matching event record as pretty JSON. Use session event names such as `tick_completed`, `attempt_completed`, or `agent_event` for relayed inner-agent records.

## Auth and model commands

```bash
plot auth
plot auth login [provider]
plot auth logout [provider]
plot models [search]
```

`login` and `logout` prompt for a provider when omitted.

Common auth path options:

- `--cwd <path>`
- `--plot-dir <path>`
- `--agent-dir <path>`

## Config commands

```bash
plot config
plot config list
plot config get defaultProvider
plot config set defaultProvider anthropic
```

Supported settings:

- `defaultProvider`
- `defaultModel`
- `defaultThinkingLevel`

Pass `--global` to read or write global Plot settings instead of project settings.

## Serve commands

```bash
plot serve api [workflow]
plot serve api [workflow] --stdio
plot serve registry
```

`serve` starts transports and daemons. `plot serve api --stdio` exposes the same session protocol as newline-delimited JSON for one workflow process. Most automation should prefer `plot api`, `plot events`, and `plot runs` unless it needs to own a protocol process directly.

## Workflow/session options

These apply to `plot`, `plot open`, `plot run`, and `plot serve api --stdio`:

- positional `[workflow]`: workflow file. Default: `WORKFLOW.md`.
- `--workflow <path>`: explicit workflow file override.
- `--session-id <id>`: unique Plot session id. Use 1–128 letters, digits, dots, underscores, or hyphens, starting with a letter or digit. Plot rejects an existing session log rather than appending a second sequence.
- `--cwd <path>`: project root for workflow execution and Plot state.
- `--plot-dir <path>`: project-local Plot state directory.
- `--agent-dir <path>`: agent auth/model state directory.
- `--session-dir <path>`: Plot session storage directory.
- `--log-level <level>`: `debug`, `info`, `warn`, or `error`.

Agent override options:

- `--provider <id>`
- `--model <id>`
- `--api-key <key>`
- `--thinking <level>`
- `--tools <list>`
- `--exclude-tools <list>`
- `--no-tools`
- `--no-builtin-tools`
- `--allow-project-config`

Resource override options:

- `--skill <path>`
- `--prompt-template <path>`
- `--no-skills`
- `--no-prompt-templates`
- `--no-context-files`
- `--system-prompt <text>`
- `--append-system-prompt <text>`

Advanced runtime options:

- `--request-queue-capacity <count>`
- `--event-capacity <count>`
- `--event-buffer-capacity <count>`
- `--tick-interval-ms <ms>`
- `--max-run-duration-ms <ms>`

## Browser/API options

`plot open --web` and `plot serve api`:

- `--port <port>`
- `--host <host>`
- `--open`: open the browser immediately. For `plot open --web`, the default is a terminal landing screen with `o` to open and `q` to stop.

## Docs and help

```bash
plot docs [topic]
plot --help
plot help <command>
plot <command> --help
```

Docs topics: `index`, `quickstart`, `workflows`, `extensions`, `tui`, `web`, `cli`, and `extension-prompt`.
