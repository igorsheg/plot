#!/usr/bin/env bun
import { runPlotCli } from "./cli.js";

runPlotCli(process.argv.slice(2)).catch((error) => {
	if (error === null || error === undefined) return;
	process.stderr.write(
		`${error instanceof Error ? error.message : String(error)}\n`,
	);
	process.exitCode = 1;
});
