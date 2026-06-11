import {
	defineCommand,
	renderUsage,
	runCommand as runCittyCommand,
	type CommandDef,
} from "citty";
import { getCliIo, setCliIo } from "./cli-context.js";
import { authCommand } from "./commands/auth.js";
import { docsCommand } from "./commands/docs.js";
import { listModelsCommand } from "./commands/list-models.js";
import { runCommand } from "./commands/run.js";
import { serveCommand } from "./commands/serve.js";
import { tuiCommand } from "./commands/tui.js";
import { processCliIo, type PlotCliIo } from "./io.js";

export const version = "0.0.0";
export { processCliIo } from "./io.js";
export type { PlotCliIo } from "./io.js";

const subCommands = {
	"list-models": listModelsCommand,
	auth: authCommand,
	docs: docsCommand,
	run: runCommand,
	tui: tuiCommand,
	serve: serveCommand,
};

const rootCommand = defineCommand({
	meta: {
		name: "plot",
		version,
		description: "A control plane for long-running coding agents.",
	},
	subCommands,
	run: async ({ rawArgs }) => {
		if (rawArgs.some((arg) => !arg.startsWith("-"))) return undefined;
		const io = getCliIo();
		await io.writeStdout(await renderUsage(rootCommand));
	},
});

export const runPlotCli = async (
	args: readonly string[],
	io: PlotCliIo = processCliIo(),
): Promise<void> => {
	const help = await renderHelp(args);
	if (help !== undefined) {
		await io.writeStdout(help);
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

const topLevelCommands = subCommands as unknown as Record<string, CommandDef>;

const renderHelp = async (args: readonly string[]) => {
	if (args[0] === "--help" || args[0] === "help") {
		return renderUsage(rootCommand);
	}
	const [command] = args;
	if (command === undefined || !args.includes("--help")) return undefined;
	const subCommand = topLevelCommands[command];
	if (subCommand === undefined) return undefined;
	return renderUsage(subCommand, rootCommand);
};
