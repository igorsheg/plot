import type { Argv } from "yargs";

const globalOptions = {
	json: {
		type: "boolean" as const,
		describe: "emit machine-readable ndjson on stdout",
		default: false,
	},
	quiet: {
		type: "boolean" as const,
		describe: "suppress non-error human output",
		default: false,
	},
};

const serverOptions = {
	port: {
		type: "number" as const,
		describe: "server port",
		default: 3000,
	},
	workflow: {
		type: "string" as const,
		describe: "path to WORKFLOW.md",
		default: "./WORKFLOW.md",
	},
	tracker: {
		type: "string" as const,
		describe: "tracker kind (local-fs or github)",
		default: "local-fs",
	},
	"github-repo": {
		type: "string" as const,
		describe: "github repo (owner/repo) for github tracker",
	},
	"issues-dir": {
		type: "string" as const,
		describe: "local issues directory",
		default: "./issues",
	},
	"log-format": {
		type: "string" as const,
		describe: "server log format",
		choices: ["pretty", "json"] as const,
		default: "pretty",
	},
	"log-level": {
		type: "string" as const,
		describe: "log level",
		choices: ["debug", "info", "warning", "error", "none"] as const,
		default: "info",
	},
};

export function withGlobalOptions<T>(
	yargs: Argv<T>,
): Argv<T & Pick<ServerOptions, "json" | "quiet">> {
	return yargs.options(globalOptions) as Argv<
		T & Pick<ServerOptions, "json" | "quiet">
	>;
}

export function withServerOptions<T>(
	yargs: Argv<T>,
): Argv<T & Omit<ServerOptions, "json" | "quiet">> {
	return yargs.options(serverOptions) as Argv<
		T & Omit<ServerOptions, "json" | "quiet">
	>;
}

export function withCliCommandOptions<T>(
	yargs: Argv<T>,
): Argv<T & ServerOptions> {
	return withGlobalOptions(withServerOptions(yargs)) as Argv<T & ServerOptions>;
}

export type ServerOptions = {
	json: boolean;
	quiet: boolean;
	port: number;
	workflow: string;
	tracker: string;
	"github-repo"?: string;
	"issues-dir": string;
	"log-format": "pretty" | "json";
	"log-level": "debug" | "info" | "warning" | "error" | "none";
	web?: boolean;
};
