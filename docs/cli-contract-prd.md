# PRD: Stellar CLI contract

Status: implemented on 2026-07-15.

## Problem

Plot now has the right public concepts, but its CLI and Session Manager boundaries do not yet make those concepts exact. Help and version can accidentally execute a Workflow, invalid invocations can succeed, errors can be rendered twice, failed starts can leave durable Session records, stopping can depend on a file that no longer exists, validation can drift between `check` and `start`, and a persistent Session Manager can silently keep using another Plot build.

Plot is not in production. This work intentionally breaks internal APIs and deletes obsolete seams. It does not add aliases, compatibility adapters, migration warnings, or public daemon controls.

## Goal

Make the complete public CLI small, pure at its informational edges, deterministic for shells, and backed by exact Workflow and Session lifecycle invariants.

```txt
plot [workflow]          Start or attach, then open the terminal dashboard
plot start [workflow]    Start a Session without attaching
plot stop [workflow]     Stop the Workflow's active Session
plot web                 Open the Fleet Web Console
plot check [workflow]    Validate Workflow and readiness
plot docs [topic]        Read bundled documentation
plot auth                Manage provider credentials
plot models [query]      List available models
```

## Product requirements

### R1. Help and version are pure

`plot --help`, `plot -h`, `plot help [command]`, `plot --version`, and `plot -v` must not:

- resolve or read a Workflow;
- connect to or start the Session Manager;
- create Plot state;
- open a browser;
- prompt for input.

They write their result to stdout and exit `0`.

### R2. Invalid invocations fail nonzero

Malformed flags, unknown commands, unknown help targets, unknown documentation topics, invalid Web ports, missing option values, and extra positional arguments are usage failures.

Usage failures write one diagnostic to stderr and exit `2`. Operational failures write one diagnostic to stderr and exit `1`. Successful commands, help, and version exit `0`.

### R3. Every error is rendered once

Command and domain code throw errors without printing them. One CLI boundary chooses the exit code and renders exactly one diagnostic. Interactive progress is not an error diagnostic and remains on stderr.

### R4. Start is atomic and transactional

The Session Manager owns the one-active-Session invariant. Concurrent starts for one canonical Workflow key share one pending start and produce one worker.

A Session becomes durable and visible only after the worker has loaded the Workflow, validated its Extension and agent policy, created its runtime, and reported ready. A failure before ready leaves no active Session, no historical error Session, and no retained Workflow claim.

After ready, an unexpected failure is durable Session history and releases the active Workflow claim.

### R5. Stop is idempotent after file disappearance

Start and check require an existing canonical Workflow file. Stop resolves a lookup key without requiring the file to exist. If the file exists, symlinks are canonicalized. If it no longer exists, the normalized absolute path can still match the stored Workflow key.

Stopping an inactive Workflow succeeds and reports that it is not running. Moving or deleting a Workflow file must not make its existing Session impossible to stop by its original path.

### R6. Check and start cannot drift

The Session package owns one Workflow preparation path that:

- resolves and loads the Workflow;
- validates provider, model, and auth;
- loads and constructs the Extension runtime;
- inspects Source requirements without discovery or actions;
- releases preparation resources.

`plot check` uses that preparation directly. Session startup uses the same preparation contract before reporting ready. Action-required Source readiness is valid and is represented as `NEEDS YOU`.

### R7. No daemon silently runs another Plot version

The private Session Manager protocol has an exact protocol/build identity handshake. Every client verifies it before issuing commands. A mismatch fails explicitly and never silently sends requests to the incompatible daemon or asks it to spawn workers.

The daemon receives the current Plot executable identity explicitly. There is no compatibility translation between private protocol versions.

### R8. Command handlers receive explicit capabilities

No command obtains terminal I/O, current directory, browser access, Session Manager access, auth state, TUI startup, or signal waiting through mutable module globals. The CLI constructs one immutable host and passes it to command handlers.

The process host is the one production implementation. Behavior tests pass a complete fake host rather than patching globals or feeding a `Partial` override bag into production construction.

### R9. The public CLI fits on one screen

Root help remains the complete public command map above. Internal worker/manager entrypoints never enter the public parser or help. Runtime capacities, paths, raw events, process registries, protocol methods, and caller-selected Session IDs remain absent.

## CLI grammar

- Exact public command names select commands.
- No first argument selects the default Workflow.
- A path-like first argument selects the default Workflow command.
- A bare unknown word is an unknown command, not an implicit Workflow.
- `-- <workflow>` explicitly selects an unusual Workflow path.
- Only one Workflow positional argument is accepted.
- `web` accepts `--host <host>` and `--port <1-65535>`.
- `docs` accepts one known topic or `--paths`.
- `auth` accepts `status`, `login [provider]`, or `logout [provider]`; omitted action means `status`.

Subcommand option tokenization uses the platform `node:util.parseArgs`. Plot owns only command selection, positional cardinality, and domain validation; it does not carry a parser framework or hand-roll flag scanning.

## CLI host contract

```txt
interface CliHost {
  readonly cwd: string;
  readonly isInteractive: boolean;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  readonly auth: SessionAuth;
  readonly sessions: () => Promise<SessionManagerClient>;
  readonly runTui: (options: TuiOptions) => Promise<void>;
  readonly startWebGateway: (options: GatewayOptions) => Promise<WebGateway>;
  readonly openBrowser: (url: string) => void;
  readonly prompt: PromptCapability;
  readonly waitForTermination: (stop: () => void) => Promise<void>;
}
```

Output writes are direct and small. The CLI does not own a write queue, unused stdin capability, injectable version/docs functions, or defensive async flush machinery.

## Non-goals

- Compatibility with removed commands or flags.
- A public machine protocol.
- Public daemon lifecycle commands.
- Automatic recovery of pre-production Sessions across incompatible manager protocols.
- More configuration flags.
- A generic command framework or plugin API.

## Acceptance tests

### Pure informational commands

- `--help`, `help start`, `--version`, and `-v` never call the Session Manager or TUI.
- Packaged `plot --version` prints the package version in an empty directory.
- Informational commands create no `~/.plot/session-manager` state in an isolated home.

### Exit and diagnostic contract

- Unknown command, help target, docs topic, option, invalid port, and extra positional argument return `2`.
- Operational failure returns `1`.
- Each failure emits exactly one stderr diagnostic and no stdout data.

### Lifecycle

- Equivalent Workflow paths concurrently start exactly one worker.
- Worker failure before ready creates no Session summary.
- Worker failure after ready creates one errored summary.
- Start and stop races terminate without duplicate workers or stranded claims.
- Stop succeeds for absent, deleted, and symlinked Workflow paths.

### Shared preparation

- `check` and worker startup call the same preparation function.
- Extensionless, invalid-model, invalid-auth, and invalid-Extension cases produce the same root diagnostic.
- `check` never discovers work, invokes actions, starts a Session, or starts the manager.

### Manager identity

- Matching protocol/build identities connect.
- A mismatched identity fails before any manager operation.
- The mismatch diagnostic identifies both client and daemon identities.

### Public surface

- Root help contains every public command exactly once.
- Removed command families and internal entrypoints are absent.
- Public docs and parser command inventory agree.

## Delivery sequence

1. Replace the mixed Citty/custom dispatch path with a typed parser and explicit CLI host.
2. Centralize one-shot error rendering and exit codes.
3. Add shared Workflow preparation and use it from check/start.
4. Make Session start transactional and stop independent of file existence.
5. Add manager protocol/build identity verification.
6. Add packaged binary smoke assertions and delete superseded files/dependencies.

## Definition of done

```txt
Help/version are pure.
Every invalid invocation fails nonzero.
Every error is rendered once.
Start is atomic and transactional.
Stop is idempotent even when the file disappeared.
Check and start cannot drift.
No daemon silently runs another Plot version.
All command handlers receive explicit capabilities.
The complete public CLI fits on one screen.
```
