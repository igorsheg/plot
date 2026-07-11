import { defineCommand } from "citty";
import { errorMessage } from "@plot/common/primitives";
import { resolveSessionPaths } from "@plot/session/paths";
import {
	inspectWorkflowExtensionReadiness,
	runWorkflowExtensionAction,
} from "@plot/session/readiness";
import {
	loadDiscoveredWorkflow,
	resolveWorkflowPath,
} from "@plot/session/workflow";
import { authPathArgs, workflowPathArg } from "../args.js";
import { getCliIo } from "../cli-context.js";
import { createCliExtensionInteraction } from "../extension-interaction.js";
import { writeCliStderr } from "../io.js";
import { bool, str, workflowPathFromArgs } from "../options.js";

export const setupCommand = defineCommand({
	meta: {
		name: "setup",
		description: "Resolve extension setup requirements.",
	},
	args: {
		...workflowPathArg,
		...authPathArgs,
		"no-browser": {
			type: "boolean",
			description: "Print setup URLs without opening a browser.",
		},
		json: {
			type: "boolean",
			description: "Print the final Source readiness as JSON.",
		},
	},
	run: async ({ args }) => {
		const io = getCliIo();
		const cwd = str(args, "cwd") ?? process.cwd();
		const workflowPath = workflowPathFromArgs(args);
		const workflowInput = { cwd } as {
			cwd: string;
			workflowPath?: string;
		};
		if (workflowPath !== undefined) workflowInput.workflowPath = workflowPath;
		const workflow = await loadDiscoveredWorkflow(workflowInput);
		const pathOptions: {
			cwd: string;
			plotDir?: string;
			agentDir?: string;
		} = { cwd };
		const plotDir = str(args, "plot-dir");
		const agentDir = str(args, "agent-dir");
		if (plotDir !== undefined) pathOptions.plotDir = plotDir;
		if (agentDir !== undefined) pathOptions.agentDir = agentDir;
		const paths = resolveSessionPaths(pathOptions);
		const controller = new AbortController();
		const abort = () => controller.abort();
		process.once("SIGINT", abort);
		process.once("SIGTERM", abort);
		const json = bool(args, "json") === true;
		const interactionIo = json
			? { ...io, writeStdout: (text: string) => writeCliStderr(io, text) }
			: io;
		const interactionOptions: {
			io: typeof interactionIo;
			noBrowser?: boolean;
		} = { io: interactionIo };
		const noBrowser = bool(args, "no-browser");
		if (noBrowser !== undefined) interactionOptions.noBrowser = noBrowser;
		const interaction = createCliExtensionInteraction(interactionOptions);
		try {
			let source = await inspectWorkflowExtensionReadiness({
				workflow,
				paths,
				signal: controller.signal,
			});
			if (source === undefined) {
				await io.writeStdout(
					json
						? `${JSON.stringify({ ready: true, source: null })}\n`
						: "OK workflow has no extension requirements\n",
				);
				return;
			}
			const attemptedActions = new Set<string>();
			while (source.readiness === "action-required") {
				const requirement = source.requirements.find(
					(candidate) => candidate.status === "action-required",
				);
				if (requirement === undefined) break;
				const action = requirement.actions?.find(
					(candidate) => candidate.disabledReason === undefined,
				);
				if (action === undefined)
					throw new Error(
						`extension requirement ${requirement.label} has no available setup action`,
					);
				const actionKey = `${requirement.id}\0${action.id}`;
				if (attemptedActions.has(actionKey))
					throw new Error(
						`extension setup action ${action.label} did not resolve ${requirement.label}`,
					);
				attemptedActions.add(actionKey);
				if (!json) {
					// eslint-disable-next-line no-await-in-loop -- interactive setup actions must run in readiness order.
					await io.writeStdout(`SETUP ${requirement.label}: ${action.label}\n`);
				}
				// eslint-disable-next-line no-await-in-loop -- each action returns the readiness used to select the next action.
				source = await runWorkflowExtensionAction({
					workflow,
					paths,
					requirementId: requirement.id,
					actionId: action.id,
					interaction,
					signal: controller.signal,
				});
			}
			if (json) {
				await io.writeStdout(
					`${JSON.stringify({ ready: source.readiness === "ready", source })}\n`,
				);
			} else if (source.readiness === "ready") {
				await io.writeStdout(`OK extension ${source.label} is ready\n`);
			}
			if (source.readiness !== "ready")
				throw new Error(
					`extension ${source.label} is ${source.readiness}; check ${resolveWorkflowPath(workflowInput)}`,
				);
		} catch (error) {
			await writeCliStderr(io, `Error: ${errorMessage(error)}\n`);
			throw error;
		} finally {
			interaction.dispose();
			process.off("SIGINT", abort);
			process.off("SIGTERM", abort);
		}
	},
});
