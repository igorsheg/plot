#!/usr/bin/env bun

import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { runServerMain } from "@plot/server";
import { runTui } from "@plot/tui";
import {
	CliError,
	createCliOutput,
	resolveRequestedOutputMode,
} from "./shared/io.js";
import { withGlobalOptions } from "./shared/options.js";
import { stripBundledEntryArg } from "./shared/runtime.js";
import { TuiCommand } from "./commands/tui.js";
import { ServeCommand } from "./commands/serve.js";
import { WebCommand } from "./commands/web.js";
import { LoginCommand } from "./commands/login.js";
import { LogoutCommand } from "./commands/logout.js";
import { AuthCommand } from "./commands/auth.js";

const VERSION = process.env["PLOT_VERSION"] ?? "0.0.1";
const CLI_NAME = process.env["PLOT_CLI_NAME"] ?? "plot-ai";
const argv = stripBundledEntryArg(hideBin(process.argv));
const output = createCliOutput(resolveRequestedOutputMode(argv));
const [internalCommand] = argv;

if (internalCommand === "__internal-server") {
	await runServerMain(process.env as Record<string, string | undefined>);
	await new Promise(() => {});
} else if (internalCommand === "__internal-tui") {
	await runTui();
} else {
	const cli = withGlobalOptions(yargs(argv))
		.scriptName(CLI_NAME)
		.wrap(Math.min(100, process.stdout.columns ?? 80))
		.help("help")
		.alias("help", "h")
		.version("version", "show version number", VERSION)
		.alias("version", "v")
		.recommendCommands()
		.usage(`${CLI_NAME} — orchestrate coding agents against an issue tracker`)
		.example(`$0`, "start the default agent dashboard")
		.example(
			`$0 serve --workflow ./WORKFLOW.md`,
			"run the orchestrator without opening a dashboard",
		)
		.example(`$0 web --port 4000`, "open the web dashboard on a custom port")
		.command(TuiCommand)
		.command(ServeCommand)
		.command(WebCommand)
		.command(LoginCommand)
		.command(LogoutCommand)
		.command(AuthCommand)
		.strict()
		.fail((msg, err) => {
			if (msg) {
				output.error({ kind: "usage", message: msg, exitCode: 2 });
				if (!output.json) {
					cli.showHelp("error");
				}
				process.exit(2);
			}
			if (err) throw err;
		});

	try {
		await cli.parse();
	} catch (error) {
		if (error instanceof CliError) {
			output.error({
				kind: error.kind,
				message: error.message,
				exitCode: error.exitCode,
			});
			process.exit(error.exitCode);
		}
		const message = error instanceof Error ? error.message : String(error);
		output.error({ kind: "runtime", message, exitCode: 1 });
		process.exit(1);
	}
}
