import { defineCommand } from "citty";
import {
	loadDiscoveredWorkflow,
	resolveWorkflowPath,
} from "@plot/session/workflow";
import { authPathArgs, workflowPathArg } from "../args.js";
import { getCliIo } from "../cli-context.js";
import { makeAuthFromArgs, str, workflowPathFromArgs } from "../options.js";

export const doctorCommand = defineCommand({
	meta: {
		name: "doctor",
		description: "Check workflow and auth readiness.",
	},
	args: {
		...workflowPathArg,
		...authPathArgs,
	},
	run: async ({ args }) => {
		const cwd = str(args, "cwd") ?? process.cwd();
		const workflowPath = workflowPathFromArgs(args);
		const workflowInput = { cwd };
		if (workflowPath !== undefined)
			Object.assign(workflowInput, { workflowPath });
		const resolvedWorkflowPath = resolveWorkflowPath(workflowInput);
		const lines: string[] = [];
		let ok = true;

		try {
			await loadDiscoveredWorkflow(workflowInput);
			lines.push(`OK workflow ${resolvedWorkflowPath}`);
		} catch (error) {
			ok = false;
			lines.push(
				`FAIL workflow ${resolvedWorkflowPath}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}

		try {
			const statuses = await makeAuthFromArgs(args).status();
			const configured = statuses.filter((status) => status.configured);
			if (configured.length > 0) {
				lines.push(
					`OK auth ${configured.map((status) => status.provider).join(", ")}`,
				);
			} else {
				ok = false;
				lines.push("FAIL auth no configured providers; run `plot auth login`");
			}
		} catch (error) {
			ok = false;
			lines.push(
				`FAIL auth: ${error instanceof Error ? error.message : String(error)}`,
			);
		}

		await getCliIo().writeStdout(`${lines.join("\n")}\n`);
		if (!ok) throw new Error("doctor found problems");
	},
});
