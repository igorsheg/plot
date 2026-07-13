import {
	defineCommand,
	renderUsage,
	runCommand as runCittyCommand,
	type CommandDef,
} from "citty";
import { workflowPathArg } from "./args.js";
import { setCliIo } from "./cli-context.js";
import { authCommand } from "./commands/auth.js";
import { checkCommand } from "./commands/check.js";
import { docsCommand } from "./commands/docs.js";
import { modelsCommand } from "./commands/models.js";
import {
	attachWorkflow,
	startCommand,
	stopCommand,
} from "./commands/session.js";
import { webCommand } from "./commands/web.js";
import { processCliIo, type PlotCliIo } from "./io.js";
import { VERSION } from "./package.js";

const version = VERSION;

export const subCommands = {
	start: startCommand,
	stop: stopCommand,
	web: webCommand,
	check: checkCommand,
	docs: docsCommand,
	auth: authCommand,
	models: modelsCommand,
};

const rootCommand = defineCommand({
	meta: {
		name: "plot",
		version,
		description: "Run durable coding-agent Workflows.",
	},
	subCommands,
});

const withDefaultSubcommand = (args: readonly string[]): readonly string[] => {
	if (args[0] === "auth" && (args[1] === undefined || args[1]!.startsWith("-")))
		return ["auth", "status", ...args.slice(1)];
	return args;
};

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
	if (first === undefined || first.startsWith("-") || !(first in subCommands)) {
		if (
			first !== undefined &&
			!first.startsWith("-") &&
			looksLikeCommand(first)
		) {
			await io.writeStdout(
				`Unknown command: ${first}\n\n${renderRootHelp(commandSuggestion(first))}`,
			);
			return;
		}
		await runCittyCommand(
			defineCommand({
				meta: { name: "plot", description: "Open a Workflow dashboard." },
				args: workflowPathArg,
				run: ({ args: parsed }) => attachWorkflow(parsed),
			}),
			{ rawArgs: [...args], showUsage: false },
		);
		return;
	}
	await runCittyCommand(rootCommand, {
		rawArgs: [...withDefaultSubcommand(args)],
		showUsage: false,
	});
};

const looksLikeCommand = (value: string): boolean =>
	!value.includes("/") && !value.endsWith(".md") && !value.startsWith(".");

const asCommandDef = (command: unknown): CommandDef => command as CommandDef;
const commandChildren = (command: CommandDef): Record<string, CommandDef> =>
	(command.subCommands ?? {}) as Record<string, CommandDef>;

const editDistance = (left: string, right: string): number => {
	const previous = Array.from(
		{ length: right.length + 1 },
		(_, index) => index,
	);
	for (let leftIndex = 1; leftIndex <= left.length; leftIndex++) {
		const current = [leftIndex];
		for (let rightIndex = 1; rightIndex <= right.length; rightIndex++) {
			const cost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
			current[rightIndex] = Math.min(
				current[rightIndex - 1]! + 1,
				previous[rightIndex]! + 1,
				previous[rightIndex - 1]! + cost,
			);
		}
		previous.splice(0, previous.length, ...current);
	}
	return previous[right.length]!;
};

const commandSuggestion = (input: string): string | undefined => {
	const best = Object.keys(subCommands)
		.map((name) => ({ name, distance: editDistance(input, name) }))
		.toSorted((left, right) => left.distance - right.distance)[0];
	return best !== undefined && best.distance <= 2 ? best.name : undefined;
};

const renderRootHelp = (suggestion?: string): string => {
	const suggestionText =
		suggestion === undefined ? "" : `\nDid you mean: plot ${suggestion}\n`;
	return `Plot runs durable coding-agent Workflows. (plot v${version})

USAGE
  plot [workflow]          Start or attach, then open the terminal dashboard
  plot start [workflow]    Start a Session without attaching
  plot stop [workflow]     Stop the Workflow's active Session
  plot web                 Open the Fleet Web Console

AUTHORING
  plot check [workflow]    Validate Workflow, Extension, Source, and model readiness
  plot docs [topic]        Read bundled documentation

ACCOUNT
  plot auth                Manage provider credentials
  plot models [query]      List available models

HELP
  plot help <command>      Show command details
  plot <command> --help    Show command details
${suggestionText}`;
};

const renderHelp = async (args: readonly string[]) => {
	if (args[0] === "--help" || args[0] === "-h") return renderRootHelp();
	if (args[0] === "help") {
		if (args[1] === undefined) return renderRootHelp();
		return renderCommandHelp(args.slice(1));
	}
	if (!args.includes("--help") && !args.includes("-h")) return undefined;
	return renderCommandHelp(args);
};

const renderCommandHelp = async (args: readonly string[]) => {
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
