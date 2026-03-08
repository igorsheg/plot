import { Options } from "@effect/cli";
import { LogLevel, Option } from "effect";

export const cliCommandOptions = {
	json: Options.boolean("json").pipe(
		Options.withDescription("emit machine-readable ndjson on stdout"),
	),
	quiet: Options.boolean("quiet").pipe(
		Options.withDescription("suppress non-error human output"),
	),
	port: Options.integer("port").pipe(
		Options.withDescription("server port"),
		Options.withDefault(3000),
	),
	workflow: Options.text("workflow").pipe(
		Options.withDescription("path to WORKFLOW.md"),
		Options.withDefault("./WORKFLOW.md"),
	),
	tracker: Options.choice("tracker", ["local-fs", "github"] as const).pipe(
		Options.withDescription("tracker kind (overrides WORKFLOW.md)"),
		Options.optional,
	),
	"github-repo": Options.text("github-repo").pipe(
		Options.withDescription("github repo (owner/repo) for github tracker"),
		Options.optional,
	),
	"issues-dir": Options.text("issues-dir").pipe(
		Options.withDescription("local issues directory"),
		Options.optional,
	),
	"log-format": Options.choice("log-format", ["pretty", "json"] as const).pipe(
		Options.withDescription("server log format"),
		Options.withDefault("pretty"),
	),
} as const;

export type ServerOptions = {
	json: boolean;
	quiet: boolean;
	port: number;
	workflow: string;
	tracker?: "local-fs" | "github";
	"github-repo"?: string;
	"issues-dir"?: string;
	"log-format": "pretty" | "json";
	"log-level": "debug" | "info" | "warning" | "error" | "none";
	web?: boolean;
};

type ParsedCliCommandOptions = {
	readonly [Key in keyof typeof cliCommandOptions]: Key extends
		| "github-repo"
		| "tracker"
		| "issues-dir"
		? Option.Option<
				Key extends "tracker" ? "local-fs" | "github" : string
			>
		: ServerOptions[Key];
};

export function toServerOptions(
	options: ParsedCliCommandOptions,
	logLevel: LogLevel.LogLevel,
	overrides?: Pick<ServerOptions, "web">,
): ServerOptions {
	return {
		json: options.json,
		quiet: options.quiet,
		port: options.port,
		workflow: options.workflow,
		tracker: Option.getOrUndefined(options.tracker),
		"github-repo": Option.getOrUndefined(options["github-repo"]),
		"issues-dir": Option.getOrUndefined(options["issues-dir"]),
		"log-format": options["log-format"],
		"log-level": toServerLogLevel(logLevel),
		...overrides,
	};
}

function toServerLogLevel(
	logLevel: LogLevel.LogLevel,
): ServerOptions["log-level"] {
	switch (logLevel._tag) {
		case "All":
		case "Trace":
		case "Debug":
			return "debug";
		case "Info":
			return "info";
		case "Warning":
			return "warning";
		case "Error":
		case "Fatal":
			return "error";
		case "None":
			return "none";
	}
}
