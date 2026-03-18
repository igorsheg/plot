import { Flag } from "effect/unstable/cli";
import { LogLevel, Option } from "effect";

export const cliCommandOptions = {
  json: Flag.boolean("json").pipe(
    Flag.withDescription("emit machine-readable ndjson on stdout"),
  ),
  verbose: Flag.boolean("verbose").pipe(
    Flag.withDescription("enable non-error human output (quiet by default)"),
  ),
  port: Flag.integer("port").pipe(
    Flag.withDescription("server port"),
    Flag.withDefault(3000),
  ),
  workflow: Flag.string("workflow").pipe(
    Flag.withDescription("path to WORKFLOW.md"),
    Flag.withDefault("./WORKFLOW.md"),
  ),
  tracker: Flag.string("tracker").pipe(
    Flag.withDescription(
      "tracker plugin: built-in name or package specifier (overrides WORKFLOW.md)",
    ),
    Flag.optional,
  ),
  "github-repo": Flag.string("github-repo").pipe(
    Flag.withDescription("github repo (owner/repo) for github tracker"),
    Flag.optional,
  ),
  "log-format": Flag.choice("log-format", ["pretty", "json"] as const).pipe(
    Flag.withDescription("server log format"),
    Flag.withDefault("pretty"),
  ),
} as const;

export type ServerOptions = {
  json: boolean;
  verbose: boolean;
  port: number;
  workflow: string;
  tracker?: string;
  "github-repo"?: string;
  "log-format": "pretty" | "json";
  "log-level": "debug" | "info" | "warning" | "error" | "none";
  web?: boolean;
};

type ParsedCliCommandOptions = {
  readonly [Key in keyof typeof cliCommandOptions]: Key extends "github-repo" | "tracker"
    ? Option.Option<string>
    : ServerOptions[Key];
};

export function toServerOptions(
  options: ParsedCliCommandOptions,
  logLevel: LogLevel.LogLevel,
  overrides?: Pick<ServerOptions, "web">,
): ServerOptions {
  return {
    json: options.json,
    verbose: options.verbose,
    port: options.port,
    workflow: options.workflow,
    tracker: Option.getOrUndefined(options.tracker),
    "github-repo": Option.getOrUndefined(options["github-repo"]),
    "log-format": options["log-format"],
    "log-level": toServerLogLevel(logLevel),
    ...overrides,
  };
}

function toServerLogLevel(logLevel: LogLevel.LogLevel): ServerOptions["log-level"] {
  switch (logLevel) {
    case "All":
    case "Trace":
    case "Debug":
      return "debug";
    case "Info":
      return "info";
    case "Warn":
      return "warning";
    case "Error":
    case "Fatal":
      return "error";
    case "None":
      return "none";
  }
}
