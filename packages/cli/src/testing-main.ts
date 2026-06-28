#!/usr/bin/env bun
import { processCliIo, runPlotCli } from "./cli.js";

runPlotCli(process.argv.slice(2), processCliIo()).catch((error) => {
	if (error === null || error === undefined) return;
	process.stderr.write(
		`${error instanceof Error ? error.message : String(error)}\n`,
	);
	process.exitCode = 1;
});
