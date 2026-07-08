import {
	defineCommand,
	renderUsage,
	runCommand as runCittyCommand,
	type CommandDef,
} from "citty";
import { sessionCommandArgs } from "./args.js";
import { setCliIo } from "./cli-context.js";
import { apiCommand } from "./commands/api.js";
import { authCommand } from "./commands/auth.js";
import { configCommand } from "./commands/config.js";
import { docsCommand } from "./commands/docs.js";
import { doctorCommand } from "./commands/doctor.js";
import { eventsCommand } from "./commands/events.js";
import { initCommand } from "./commands/init.js";
import { modelsCommand } from "./commands/models.js";
import { openCommand } from "./commands/open.js";
import { runCommand } from "./commands/run.js";
import { runsCommand } from "./commands/runs.js";
import { serveCommand } from "./commands/serve.js";
import { processCliIo, type PlotCliIo } from "./io.js";
import { VERSION } from "./package.js";

const version = VERSION;

const rootArgs = sessionCommandArgs;

const subCommands = {
	open: openCommand,
	run: runCommand,
	runs: runsCommand,
	api: apiCommand,
	events: eventsCommand,
	auth: authCommand,
	models: modelsCommand,
	init: initCommand,
	doctor: doctorCommand,
	config: configCommand,
	docs: docsCommand,
	serve: serveCommand,
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

const withDefaultSubcommand = (args: readonly string[]): readonly string[] => {
	const first = args[0];
	const second = args[1];
	if (first === "runs" && (second === undefined || second.startsWith("-")))
		return ["runs", "list", ...args.slice(1)];
	if (first === "auth" && (second === undefined || second.startsWith("-")))
		return ["auth", "status", ...args.slice(1)];
	if (first === "config" && (second === undefined || second.startsWith("-")))
		return ["config", "list", ...args.slice(1)];
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
	if (first === undefined || first.startsWith("-")) {
		await runCittyCommand(openCommand, {
			rawArgs: [...args],
			showUsage: false,
		});
		return;
	}
	if (first in subCommands) {
		await runCittyCommand(rootCommand, {
			rawArgs: [...withDefaultSubcommand(args)],
			showUsage: false,
		});
		return;
	}
	await io.writeStdout(
		`Unknown command: ${first}\n\n${renderRootHelp(commandSuggestion(first))}`,
	);
};

const asCommandDef = (command: unknown): CommandDef => command as CommandDef;

const commandChildren = (command: CommandDef): Record<string, CommandDef> =>
	(command.subCommands ?? {}) as Record<string, CommandDef>;

const commandNames = Object.keys(subCommands);

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
	const scored = commandNames
		.map((name) => ({ name, distance: editDistance(input, name) }))
		.toSorted((left, right) => left.distance - right.distance);
	const best = scored[0];
	return best !== undefined && best.distance <= 2 ? best.name : undefined;
};

const renderRootHelp = (suggestion?: string): string => {
	const suggestionText =
		suggestion === undefined ? "" : `\nDid you mean: plot ${suggestion}\n`;
	return `Run coding-agent workflows. (plot v${version})

USAGE
  plot                         Open the terminal dashboard
  plot open [workflow]          Open a dashboard for a workflow
  plot open [workflow] --web    Open the browser dashboard
  plot run [workflow]           Run one workflow pass without a dashboard
  plot runs                     List runs in the shared registry
  plot api schema               Print the public session protocol schema
  plot events wait <run-id>      Wait for a live run event

START HERE
  plot init
  plot auth
  plot auth login
  plot open WORKFLOW.md

COMMANDS
  open, run                     Start workflows
  runs, events                  Inspect and coordinate live runs
  api                           Inspect and call the public session protocol
  auth, models                  Manage provider auth and models
  init, doctor, config          Set up and validate a project
  docs, serve                   Read docs or serve transports/daemons

HELP
  plot help <command>            Show command details
  plot <command> --help          Show command details
  plot open --help               Show workflow/dashboard options
  plot docs cli                  Print the CLI API map
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
