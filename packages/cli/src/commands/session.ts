import { defineCommand, type ParsedArgs } from "citty";
import type { PlotTuiOptions } from "@plot/tui/plot-tui";
import { resolveWorkflowPath } from "@plot/session/workflow";
import { workflowPathArg } from "../args.js";
import { getCliIo } from "../cli-context.js";
import { workflowPathFromArgs } from "../options.js";
import { getSessionManager } from "../session-manager.js";

const workflowInput = (args: ParsedArgs) => {
	const input: { cwd: string; workflowPath?: string } = {
		cwd: process.cwd(),
	};
	const workflowPath = workflowPathFromArgs(args);
	if (workflowPath !== undefined) input.workflowPath = workflowPath;
	return input;
};

export const attachWorkflow = async (args: ParsedArgs): Promise<void> => {
	const io = getCliIo();
	const manager = await getSessionManager();
	const { session } = await manager.start(workflowInput(args));
	const runTui =
		(io.runTui as
			| ((options: PlotTuiOptions) => Promise<void> | void)
			| undefined) ?? (await import("@plot/tui/plot-tui")).runPlotTui;
	await runTui({ manager, session });
};

export const startCommand = defineCommand({
	meta: {
		name: "start",
		description: "Start a Workflow without attaching.",
	},
	args: workflowPathArg,
	run: async ({ args }) => {
		const result = await (await getSessionManager()).start(workflowInput(args));
		await getCliIo().writeStdout(
			`${result.started ? "Started" : "Already running"} ${result.session.workflowName}\n`,
		);
	},
});

export const stopCommand = defineCommand({
	meta: {
		name: "stop",
		description: "Stop a Workflow's active Session.",
	},
	args: workflowPathArg,
	run: async ({ args }) => {
		const input = workflowInput(args);
		const workflowPath = resolveWorkflowPath(input);
		const session = await (await getSessionManager()).stop(workflowPath);
		await getCliIo().writeStdout(
			session === undefined
				? `${workflowPath} is not running\n`
				: `Stopped ${session.workflowName}\n`,
		);
	},
});
