#!/usr/bin/env bun
import { runCommand as runCittyCommand } from "citty";
import { runPlotCli } from "./cli.js";
import { apiCommand } from "./commands/api.js";

const args = process.argv.slice(2);
const run =
	args[0] === "__internal-api-stdio"
		? runCittyCommand(apiCommand, {
				rawArgs: ["--stdio", ...args.slice(1)],
				showUsage: false,
			})
		: runPlotCli(args);

run.catch((error) => {
	if (error === null || error === undefined) return;
	process.stderr.write(
		`${error instanceof Error ? error.message : String(error)}\n`,
	);
	process.exitCode = 1;
});
