# CLI

The npm package is `plot-ai`; its binary is `plot`.

## Complete command map

```txt
plot [workflow]          start or attach, then open the terminal dashboard
plot start [workflow]    start without attaching
plot stop [workflow]     stop the Workflow's Active Plot Session
plot web                 open the Fleet Web Console
plot check [workflow]    validate Workflow and readiness
plot docs [topic]        print bundled documentation
plot auth                show provider authentication status
plot auth login [name]   authenticate a provider
plot auth logout [name]  remove provider authentication
plot models [query]      list available models
```

The Workflow defaults to `WORKFLOW.md` in the current directory.

## Session lifecycle

### `plot [workflow]`

Plot canonicalizes the Workflow file path and starts or gets its Active Plot Session. Equivalent paths to the same file attach to the same Session.

The terminal dashboard reconstructs its projection from durable Session History and follows live events. Exiting with `q`, Ctrl-C, or terminal loss only detaches.

### `plot start [workflow]`

Start without opening a dashboard. The operation is idempotent:

```txt
Started review-acme
Already running review-acme
```

### `plot stop [workflow]`

Stop by Workflow, not by an internal process or Session identifier. Stopping an inactive Workflow succeeds with an informational message.

### `plot web`

Open the local Fleet Web Console. It is not scoped to one Workflow and does not silently create one. Development and supervised deployments may set `--host` and `--port`.

## Validation

```bash
plot check WORKFLOW.md
```

`check`:

- parses the Workflow;
- requires and loads its Extension;
- parses Extension configuration;
- constructs the Extension runtime;
- checks Source requirements;
- validates Workflow provider/model selection and auth.

It never discovers work, invokes an Operator Action, opens a browser, or starts a Session.

An action-required Source is reported as `NEEDS YOU` but remains a valid Workflow. Start the Workflow and resolve its Operator Action in the TUI or Web Console.

## Auth and models

```bash
plot auth
plot auth login
plot auth logout anthropic
plot models
plot models claude
```

Provider credentials are global agent state. Provider, model, thinking, tools, resources, and scheduling policy are Workflow configuration.

## Bundled docs

```bash
plot docs
plot docs quickstart
plot docs guide
plot docs workflows
plot docs extensions
plot docs sdk
plot docs tui
plot docs web
plot docs cli
plot docs --paths
```

`plot docs sdk` prints the supported `plot-ai/sdk` declarations.

## Intentionally absent

Plot does not expose commands for process registries, raw event streams, Session protocol methods, daemons, arbitrary settings, or caller-chosen Session IDs. Worker IPC, RuntimeEvents, and browser routes are private implementation details used by Plot's own dashboards.

Help routing:

```bash
plot --help
plot help <command>
plot <command> --help
```
