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
  plot                          Open the terminal dashboard
  plot open [workflow]          Open a dashboard for a workflow
  plot open [workflow] --web    Open the browser dashboard
  plot run [workflow]           Run current work without a dashboard
  plot runs                     List runs in the shared registry
  plot api schema               Print the public session protocol schema
  plot events wait <run-id>     Replay/follow events until one matches

START HERE
  plot init
  plot auth login
  plot doctor WORKFLOW.md
  plot open WORKFLOW.md

COMMANDS
  open, run                     Start Workflows
  runs, events                  Inspect managed runs and RuntimeEvents
  api                           Inspect/call the Session protocol
  auth, models, config          Manage provider auth, models, and defaults
  init, doctor                  Create and validate a Workflow
  docs, serve                   Read references or serve transports/daemons

AUTHOR A SOURCE-DRIVEN EXTENSION
  WORKFLOW.md:
    ---
    agent: { maxTurns: 1 }
    extension: { source: ./queue.extension.ts }
    ---
    Complete {{ work.title }}. Call \`mark_complete\` only when done.

  queue.extension.ts:
    import { definePlotExtension, defineTool } from "plot-ai/sdk";

    const done = new Set<string>();
    export default definePlotExtension({
      id: "queue",
      create({ registerTool, work }) {
        registerTool(({ work: current }) => defineTool({
          name: "mark_complete",
          label: "Mark complete",
          description: "Mark the selected demo Work Item complete.",
          parameters: { type: "object", properties: {} },
          execute: async () => {
            done.add(current.id);
            return {
              content: [{ type: "text", text: "Marked complete." }],
              terminate: true,
            };
          },
        }));
        return {
          async discover() {
            return done.has("queue:1") ? [] : [work({
              id: "queue:1",
              version: "1",
              title: "Handle queue item",
              context: { repository: "acme/web" },
            })];
          },
        };
      },
    });

  CONTRACT
    - Stable id = domain identity; version = revision/rerun trigger.
    - Discovery states: pending | waiting | blocked | cancelled | absent.
    - Return [] only when authoritative work is gone; throw on discovery failure.
    - The extension owns facts and idempotent integration tools.
    - The Workflow prompt owns agent judgment; Plot owns scheduling/retries.
    - Tools require name, label, description, parameters, and execute.
    - Import only from "plot-ai/sdk"; extensions are trusted, not sandboxed.

  Validate with: plot doctor WORKFLOW.md
  Full contract: plot docs extensions
  LLM brief:     plot docs extension-prompt

HELP
  plot help <command>            Show command details
  plot <command> --help          Show command details
  plot open --help               Show Workflow/dashboard options
  plot docs cli                  Print the complete CLI/protocol reference
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
