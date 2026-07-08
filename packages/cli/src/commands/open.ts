import type { Mutable } from "@plot/common/primitives";
import { defineCommand, type ParsedArgs } from "citty";
import { startPlotWebGateway } from "@plot/gateway";
import { sessionCommandArgs, workflowPathArg } from "../args.js";
import { getCliIo } from "../cli-context.js";
import { openBrowser } from "../io.js";
import { baseOptions, int, str, workflowPathFromArgs } from "../options.js";
import { resolvePlotCommand } from "../plot-command.js";
import type { RunInProcessOnceOptions } from "../runtime.js";
import { renderWebDashboardReady } from "../terminal.js";

export const runTerminalDashboard = async (args: ParsedArgs) => {
	const io = getCliIo();
	const runTui = io.runTui ?? (await import("@plot/tui/plot-tui")).runPlotTui;
	const options: Mutable<
		RunInProcessOnceOptions & { cli?: ReturnType<typeof resolvePlotCommand> }
	> = baseOptions(args);
	options.cli = resolvePlotCommand();
	if (io.createAgentSession !== undefined)
		options.createAgentSession = io.createAgentSession;
	return runTui(options);
};

const chunkText = (chunk: string | Uint8Array): string =>
	typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);

const withRawInput = async <A>(work: () => Promise<A>): Promise<A> => {
	const input = process.stdin;
	const canSetRaw =
		input.isTTY === true && typeof input.setRawMode === "function";
	if (canSetRaw) {
		input.setRawMode(true);
		input.resume();
	}
	try {
		return await work();
	} finally {
		if (canSetRaw) {
			input.setRawMode(false);
			input.pause();
		}
	}
};

const waitForWebDashboardExit = async (url: string) =>
	withRawInput(
		() =>
			new Promise<void>((resolve) => {
				const onSigint = () => resolve();
				process.once("SIGINT", onSigint);
				void (async () => {
					for await (const chunk of getCliIo().stdin) {
						const text = chunkText(chunk);
						if (text.includes("o")) openBrowser(url);
						if (text.includes("q") || text.includes("\u0003")) break;
					}
				})().finally(() => {
					process.off("SIGINT", onSigint);
					resolve();
				});
			}),
	);

export const runWebDashboard = async (args: ParsedArgs) => {
	const io = getCliIo();
	const options: Mutable<Parameters<typeof startPlotWebGateway>[0]> = {
		cwd: str(args, "cwd") ?? process.cwd(),
		open: args["open"] === true,
		openUrl: openBrowser,
		cli: resolvePlotCommand(),
	};
	const agentDir = str(args, "agent-dir");
	const workflowPath = workflowPathFromArgs(args);
	const port = int(args, "port");
	const host = str(args, "host");
	if (agentDir !== undefined) options.agentDir = agentDir;
	if (workflowPath !== undefined) options.workflowPath = workflowPath;
	if (port !== undefined) options.port = port;
	if (host !== undefined) options.host = host;
	const gateway = await startPlotWebGateway(options);
	await io.writeStdout(renderWebDashboardReady(gateway.url));
	try {
		await waitForWebDashboardExit(gateway.url);
	} finally {
		gateway.stop();
	}
};

export const openCommand = defineCommand({
	meta: {
		name: "open",
		description: "Open a Plot dashboard for a workflow.",
	},
	args: {
		...workflowPathArg,
		...sessionCommandArgs,
		web: {
			type: "boolean",
			description:
				"Open the browser dashboard instead of the terminal dashboard.",
		},
		port: {
			type: "string",
			description: "Browser dashboard port. Default: random free port.",
			valueHint: "port",
		},
		host: {
			type: "string",
			description: "Browser dashboard host. Default: 127.0.0.1.",
			valueHint: "host",
		},
		open: {
			type: "boolean",
			description: "For --web, open the browser immediately.",
		},
	},
	run: ({ args }) =>
		args["web"] === true ? runWebDashboard(args) : runTerminalDashboard(args),
});
