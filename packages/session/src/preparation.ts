import { realpath } from "node:fs/promises";
import type { SourceRecord } from "@plot/agent/model";
import { errorMessage } from "@plot/common/primitives";
import { loadPlotExtensionRuntimeFromWorkflow } from "./extension-loader.js";
import {
	checkRequirements,
	extensionRequirements,
	sourceIdForExtension,
} from "./extension-source.js";
import {
	resolveSessionPaths,
	type SessionPathOptions,
	type SessionPaths,
} from "./paths.js";
import { assertWorkflowAgentReady } from "./pi-session.js";
import {
	loadWorkflow,
	resolveWorkflowPath,
	WorkflowBoundaryError,
	type WorkflowDefinition,
} from "./workflow.js";

export interface PrepareWorkflowOptions extends SessionPathOptions {
	readonly workflowPath?: string;
	readonly skipAgentReadiness?: boolean;
}

export interface PreparedWorkflow {
	readonly workflow: WorkflowDefinition;
	readonly paths: SessionPaths;
	readonly source: SourceRecord;
}

export const loadWorkflowForSession = async (
	options: PrepareWorkflowOptions,
): Promise<{
	readonly workflow: WorkflowDefinition;
	readonly paths: SessionPaths;
}> => {
	const paths = resolveSessionPaths(options);
	const requested = resolveWorkflowPath(options);
	let path: string;
	try {
		path = await realpath(requested);
	} catch (error) {
		throw new WorkflowBoundaryError({
			phase: "read",
			path: requested,
			message: errorMessage(error),
		});
	}
	const workflow = await loadWorkflow(path);
	if (options.skipAgentReadiness !== true)
		assertWorkflowAgentReady(workflow, paths);
	return { workflow, paths };
};

export const prepareWorkflow = async (
	options: PrepareWorkflowOptions,
): Promise<PreparedWorkflow> => {
	try {
		const prepared = await loadWorkflowForSession(options);
		const loaded = await loadPlotExtensionRuntimeFromWorkflow(prepared);
		const controller = new AbortController();
		try {
			const source = await checkRequirements({
				sourceId: sourceIdForExtension(loaded.extension),
				label: loaded.extension.label ?? loaded.extension.id,
				requirements: extensionRequirements(loaded.runtime),
				credentials: loaded.credentials,
				signal: controller.signal,
			});
			return { ...prepared, source };
		} finally {
			await loaded.runtime.shutdown?.({ signal: controller.signal });
		}
	} catch (error) {
		if (error instanceof WorkflowBoundaryError) throw error;
		throw new WorkflowBoundaryError({
			phase: "prepare",
			path: resolveWorkflowPath(options),
			message: errorMessage(error),
		});
	}
};
