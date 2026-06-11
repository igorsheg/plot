import { DEFAULT_WORKFLOW_PATH } from "@plot/session/workflow";
import { defineCommand, runCommand as runCittyCommand } from "citty";
import { getCliIo, setCliIo } from "./cli-context.js";
import { authCommand } from "./commands/auth.js";
import { listModelsCommand } from "./commands/list-models.js";
import { runCommand } from "./commands/run.js";
import { serveCommand } from "./commands/serve.js";
import { tuiCommand } from "./commands/tui.js";
import { processCliIo, type PlotCliIo } from "./io.js";

export const version = "0.0.0";
export { processCliIo } from "./io.js";
export type { PlotCliIo } from "./io.js";

const rootCommand = defineCommand({
	meta: {
		name: "plot",
		version,
		description: "LLM that ticks()",
	},
	subCommands: {
		"list-models": listModelsCommand,
		auth: authCommand,
		run: runCommand,
		tui: tuiCommand,
		serve: serveCommand,
	},
	run: ({ rawArgs }) => {
		if (rawArgs.some((arg) => !arg.startsWith("-"))) return undefined;
		const io = getCliIo();
		return io.writeStdout(
			`plot ${version}\nCommands: list-models, auth status|login|logout, run, tui, serve stdio\nDefault workflow: ${DEFAULT_WORKFLOW_PATH}\n`,
		);
	},
});

export const runPlotCli = async (
	args: readonly string[],
	io: PlotCliIo = processCliIo(),
): Promise<void> => {
	if (args[0] === "--help" || args[0] === "help") {
		await io.writeStdout(
			`plot ${version}\nCommands: list-models, auth status|login|logout, run, tui, serve stdio\nDefault workflow: ${DEFAULT_WORKFLOW_PATH}\n`,
		);
		return;
	}
	setCliIo(io);
	await runCittyCommand(rootCommand, {
		rawArgs: [...args],
		showUsage: false,
	});
};

export const makePlotCommand = (_io: PlotCliIo = processCliIo()) => ({
	version,
});
