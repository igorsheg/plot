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
import { docsCommand } from "./commands/docs.js";
import { listModelsCommand } from "./commands/list-models.js";
import { runCommand } from "./commands/run.js";
import { serveCommand } from "./commands/serve.js";
import { stopCommand } from "./commands/stop.js";
import { webCommand } from "./commands/web.js";
import { processCliIo, type PlotCliIo } from "./io.js";
import { baseOptions, bool } from "./options.js";

export const version = "0.0.0";
export { processCliIo } from "./io.js";
export type { PlotCliIo } from "./io.js";

const rootArgs = {
	...sessionCommandArgs,
	"no-server": {
		type: "boolean" as const,
		description:
			"Run a private in-process session instead of the shared Local Plot Server.",
	},
};

const runRootTui = async ({
	args,
	rawArgs,
}: {
	args: ParsedArgs;
	rawArgs: readonly string[];
}) => {
	const io = getCliIo();
	const runTui = io.runTui ?? (await import("@plot/tui/plot-tui")).runPlotTui;
	const noServer = bool(args, "no-server") || rawArgs.includes("--no-server");
	return runTui({
		...baseOptions(args),
		...(noServer ? { noServer: true } : {}),
		...(io.createAgentSession === undefined
			? {}
			: { createAgentSession: io.createAgentSession }),
	});
};

const tuiCommand = defineCommand({
	meta: {
		name: "tui",
		description: "Open the terminal dashboard for one Plot Session.",
	},
	args: rootArgs,
	run: runRootTui,
});

const subCommands = {
	"list-models": listModelsCommand,
	auth: authCommand,
	docs: docsCommand,
	run: runCommand,
	tui: tuiCommand,
	web: webCommand,
	stop: stopCommand,
	_serve: serveCommand,
};

const rootMeta = {
	name: "plot",
	version,
	description: "A control plane for long-running coding agents.",
};

const rootTuiCommand = defineCommand({
	meta: rootMeta,
	args: rootArgs,
	run: runRootTui,
});

const rootCommand = defineCommand({
	meta: rootMeta,
	args: rootArgs,
	subCommands,
	run: runRootTui,
});

const stringOptions = new Set([
	"--skill",
	"--prompt-template",
	"--system-prompt",
	"--append-system-prompt",
	"--provider",
	"--model",
	"--api-key",
	"--thinking",
	"--tools",
	"--exclude-tools",
	"--request-queue-capacity",
	"--event-capacity",
	"--replay-capacity",
	"--tick-interval-ms",
	"--max-run-duration-ms",
	"--log-level",
	"--log-format",
	"--cwd",
	"--plot-dir",
	"--agent-dir",
	"--session-dir",
	"--workflow",
	"--session-id",
]);

const subCommandInvocation = (args: readonly string[]) => {
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === undefined) break;
		if (arg.startsWith("--")) {
			const name = arg.split("=", 1)[0] ?? arg;
			if (!arg.includes("=") && stringOptions.has(name)) index += 1;
			continue;
		}
		if (arg.startsWith("-")) continue;
		if (arg in subCommands)
			return {
				commandName: arg as keyof typeof subCommands,
				args: [...args.slice(0, index), ...args.slice(index + 1)],
			};
		return null;
	}
	return undefined;
};

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
	const subCommand = subCommandInvocation(args);
	if (subCommand === null) {
		await io.writeStdout(
			stripInternalCommands(
				await renderUsage(rootCommand as unknown as CommandDef),
			),
		);
		return;
	}
	if (subCommand !== undefined) {
		await runCittyCommand(
			subCommands[subCommand.commandName] as unknown as CommandDef,
			{
				rawArgs: subCommand.args,
				showUsage: false,
			},
		);
		return;
	}
	await runCittyCommand(rootTuiCommand as unknown as CommandDef, {
		rawArgs: [...args],
		showUsage: false,
	});
};

export const makePlotCommand = (_io: PlotCliIo = processCliIo()) => ({
	version,
});

const commandChildren = (command: CommandDef): Record<string, CommandDef> =>
	(command.subCommands ?? {}) as Record<string, CommandDef>;

const stripInternalCommands = (usage: string): string =>
	usage
		.replace("|_serve", "")
		.split("\n")
		.filter((line) => !line.includes("`_serve`"))
		.join("\n");

const renderHelp = async (args: readonly string[]) => {
	if (args[0] === "--help" || args[0] === "help") {
		return stripInternalCommands(
			await renderUsage(rootCommand as unknown as CommandDef),
		);
	}
	if (!args.includes("--help") && !args.includes("-h")) return undefined;
	let command: CommandDef = rootCommand as unknown as CommandDef;
	let parent: CommandDef | undefined;
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === undefined) break;
		if (arg.startsWith("--")) {
			const name = arg.split("=", 1)[0] ?? arg;
			if (!arg.includes("=") && stringOptions.has(name)) index += 1;
			continue;
		}
		if (arg.startsWith("-")) continue;
		const child = commandChildren(command)[arg];
		if (child === undefined) break;
		parent = command;
		command = child;
	}
	const usage = await renderUsage(command, parent);
	return parent === undefined ? stripInternalCommands(usage) : usage;
};
