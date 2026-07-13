import { realpath } from "node:fs/promises";
import { defineCommand } from "citty";
import { assertWorkflowAgentReady } from "@plot/session/pi-session";
import { resolveSessionPaths } from "@plot/session/paths";
import { inspectWorkflowExtensionReadiness } from "@plot/session/readiness";
import { loadWorkflow, resolveWorkflowPath } from "@plot/session/workflow";
import { workflowPathArg } from "../args.js";
import { getCliIo } from "../cli-context.js";
import { workflowPathFromArgs } from "../options.js";

export const checkWorkflow = async (input: {
	readonly cwd: string;
	readonly workflowPath?: string;
}): Promise<string> => {
	const resolved = await realpath(resolveWorkflowPath(input));
	const workflow = await loadWorkflow(resolved);
	const paths = resolveSessionPaths({ cwd: input.cwd });
	assertWorkflowAgentReady(workflow, paths);
	const source = await inspectWorkflowExtensionReadiness({ workflow, paths });
	const lines = [`OK Workflow ${resolved}`, `OK Extension ${source.label}`];
	for (const requirement of source.requirements) {
		if (requirement.status === "ready") continue;
		const prefix =
			requirement.status === "action-required" ? "NEEDS YOU" : "WAIT";
		lines.push(
			`${prefix} ${requirement.label}: ${requirement.message ?? requirement.status}`,
		);
	}
	return `${lines.join("\n")}\n`;
};

export const checkCommand = defineCommand({
	meta: {
		name: "check",
		description: "Validate a Workflow and its readiness.",
	},
	args: workflowPathArg,
	run: async ({ args }) => {
		const input: { cwd: string; workflowPath?: string } = {
			cwd: process.cwd(),
		};
		const workflowPath = workflowPathFromArgs(args);
		if (workflowPath !== undefined) input.workflowPath = workflowPath;
		await getCliIo().writeStdout(await checkWorkflow(input));
	},
});
