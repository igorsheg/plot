import type { Mutable } from "@plot/common/primitives";
import {
	defineCommand,
	renderUsage,
	runCommand as runCittyCommand,
	type CommandDef,
	type ParsedArgs,
} from "citty";
import { sessionCommandArgs } from "./args.js";
import { getCliIo, setCliIo } from "./cli-context.js";
import { authCommand } from "./commands/auth.js";
import { apiCommand } from "./commands/api.js";
import { docsCommand } from "./commands/docs.js";
import { listModelsCommand } from "./commands/list-models.js";
import { registryCommand } from "./commands/registry.js";
import { runCommand } from "./commands/run.js";
import {
	listRunsCommand,
	logsRunCommand,
	pruneRunsCommand,
	statusRunCommand,
	stopRunCommand,
} from "./commands/runs.js";
import { webCommand } from "./commands/web.js";
import { processCliIo, type PlotCliIo } from "./io.js";
import { baseOptions } from "./options.js";
import type { RunInProcessOnceOptions } from "./runtime.js";
import { VERSION } from "./package.js";
import { resolvePlotCommand } from "./plot-command.js";

const version = VERSION;

const rootArgs = sessionCommandArgs;

const runRootTui = async ({
	args,
	rawArgs,
}: {
	args: ParsedArgs;
	rawArgs: readonly string[];
}) => {
	const io = getCliIo();
	const runTui = io.runTui ?? (await import("@plot/tui/plot-tui")).runPlotTui;
	void rawArgs;
	const options: Mutable<
		RunInProcessOnceOptions & { cli?: ReturnType<typeof resolvePlotCommand> }
	> = baseOptions(args);
	options.cli = resolvePlotCommand();
	if (io.createAgentSession !== undefined)
		options.createAgentSession = io.createAgentSession;
	return runTui(options);
};

const tuiCommand = defineCommand({
	meta: {
		name: "tui",
		description: "Open the terminal dashboard for one Plot run.",
	},
	args: rootArgs,
	run: runRootTui,
});

const subCommands = {
	"list-models": listModelsCommand,
	auth: authCommand,
	docs: docsCommand,
	run: runCommand,
	registry: registryCommand,
	tui: tuiCommand,
	web: webCommand,
	api: apiCommand,
	ls: listRunsCommand,
	status: statusRunCommand,
	stop: stopRunCommand,
	logs: logsRunCommand,
	prune: pruneRunsCommand,
};

const rootMeta = {
	name: "plot",
	version,
	description: "Run coding-agent workflows.",
};

const rootCommand = defineCommand({
	meta: rootMeta,
	args: rootArgs,
	subCommands,
});

export const runPlotCli = async (
	args: readonly string[],
	io: PlotCliIo = processCliIo(),
): Promise<void> => {
	setCliIo(io);
	const help = await renderHelp(args);
	if (help !== undefined) {
		await io.writeStdout(help);
		return;
	}
	const first = args[0];
	if (first === undefined || first.startsWith("-")) {
		await runCittyCommand(tuiCommand, {
			rawArgs: [...args],
			showUsage: false,
		});
		return;
	}
	if (first in subCommands) {
		await runCittyCommand(rootCommand, {
			rawArgs: [...args],
			showUsage: false,
		});
		return;
	}
	await io.writeStdout(await renderUsage(rootCommand));
};

const asCommandDef = (command: unknown): CommandDef => command as CommandDef;

const commandChildren = (command: CommandDef): Record<string, CommandDef> =>
	(command.subCommands ?? {}) as Record<string, CommandDef>;

const renderHelp = async (args: readonly string[]) => {
	if (args[0] === "--help" || args[0] === "help")
		return renderUsage(rootCommand);
	if (!args.includes("--help") && !args.includes("-h")) return undefined;
	let command = asCommandDef(rootCommand);
	let parent: CommandDef | undefined;
	for (const arg of args) {
		if (arg.startsWith("-")) break;
		const child = commandChildren(command)[arg];
		if (child === undefined) break;
		parent = command;
		command = asCommandDef(child);
	}
	return renderUsage(command, parent);
};
