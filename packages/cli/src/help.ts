const renderRootHelp = (
	version: string,
): string => `Plot runs durable coding-agent Workflows. (plot v${version})

USAGE
  plot [workflow]          Start or attach, then open the terminal dashboard
  plot start [workflow]    Start a Session without attaching
  plot stop [workflow]     Stop the Workflow's active Session
  plot web                 Open the Fleet Web Console

AUTHORING
  plot check [workflow]    Validate Workflow, Extension, Source, and model readiness
  plot docs [topic]        Read bundled documentation

ACCOUNT
  plot auth                Manage provider credentials
  plot models [query]      List available models

HELP
  plot help <command>      Show command details
  plot <command> --help    Show command details
`;

const commandHelp = {
	start: `Start a Workflow without attaching.

USAGE
  plot start [workflow]

The Workflow defaults to WORKFLOW.md. Starting is idempotent.
`,
	stop: `Stop a Workflow's active Session.

USAGE
  plot stop [workflow]

The Workflow defaults to WORKFLOW.md. Stopping is idempotent, including after
the Workflow file has been removed.
`,
	web: `Open the Fleet Web Console.

USAGE
  plot web [--host <host>] [--port <port>]

OPTIONS
  --host <host>  Bind host. Default: 127.0.0.1.
  --port <port>  Bind port. Default: random free port.
`,
	check: `Validate a Workflow and its readiness.

USAGE
  plot check [workflow]

Validation does not discover work, invoke actions, or start a Session.
`,
	docs: `Read bundled documentation.

USAGE
  plot docs [topic]
  plot docs --paths

TOPICS
  index quickstart guide workflows extensions sdk tui web cli
`,
	auth: `Manage provider authentication.

USAGE
  plot auth
  plot auth login [provider]
  plot auth logout [provider]
`,
	"auth status": `Show provider authentication status.

USAGE
  plot auth status
`,
	"auth login": `Start an interactive provider login.

USAGE
  plot auth login [provider]
`,
	"auth logout": `Remove stored authentication for a provider.

USAGE
  plot auth logout [provider]
`,
	models: `List provider models visible to Plot auth.

USAGE
  plot models [query]
`,
} as const;

export type CliHelpTarget = "root" | keyof typeof commandHelp;

export const isHelpTarget = (value: string): value is CliHelpTarget =>
	value === "root" || Object.hasOwn(commandHelp, value);

export const renderHelp = (target: CliHelpTarget, version: string): string =>
	target === "root" ? renderRootHelp(version) : commandHelp[target];
