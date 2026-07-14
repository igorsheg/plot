import { realpath } from "node:fs/promises";
import type { SourceRecord } from "@plot/agent/model";
import { errorMessage } from "@plot/common/primitives";
import { loadPlotExtensionRuntimeFromWorkflow } from "./extension-loader.js";
import {
	checkRequirements,
	extensionRequirements,
	makePlotExtensionSourceBundle,
	sourceIdForExtension,
	type PlotExtensionSourceBundle,
} from "./extension-source.js";
import {
	resolveSessionPaths,
	type SessionPathOptions,
	type SessionPaths,
} from "./paths.js";
import { assertWorkflowAgentReady } from "./pi-session.js";
import { type ConsoleDiagnostic, withScopedConsole } from "./scoped-console.js";
import {
	loadWorkflow,
	resolveWorkflowPath,
	WorkflowBoundaryError,
	type WorkflowDefinition,
} from "./workflow.js";

export interface PrepareWorkflowOptions extends SessionPathOptions {
	readonly workflowPath?: string;
	readonly skipAgentReadiness?: boolean;
	readonly diagnostic?: (diagnostic: ConsoleDiagnostic) => Promise<void> | void;
}

export interface PreparedWorkflow {
	readonly workflow: WorkflowDefinition;
	readonly paths: SessionPaths;
	readonly source: SourceRecord;
	readonly takeExtensionBundle: () => PlotExtensionSourceBundle;
	readonly close: () => Promise<void>;
}

/**
 * The shared preflight for `plot check` and Session startup. It loads the
 * Workflow and Extension, validates agent readiness, and inspects Source
 * requirements without discovery or actions.
 */
const prepare = async (
	options: PrepareWorkflowOptions,
): Promise<PreparedWorkflow> => {
	const paths = resolveSessionPaths(options);
	const requestedWorkflowPath = resolveWorkflowPath(options);
	let workflowPath: string;
	try {
		workflowPath = await realpath(requestedWorkflowPath);
	} catch (error) {
		throw new WorkflowBoundaryError({
			phase: "read",
			path: requestedWorkflowPath,
			message: errorMessage(error),
		});
	}
	const workflow = await loadWorkflow(workflowPath);
	if (options.skipAgentReadiness !== true)
		assertWorkflowAgentReady(workflow, paths);
	const loaded = await loadPlotExtensionRuntimeFromWorkflow({
		workflow,
		paths,
	});
	const controller = new AbortController();
	let transferred = false;
	let closed = false;
	const close = async () => {
		if (closed || transferred) return;
		closed = true;
		controller.abort();
		await loaded.runtime.shutdown?.({ signal: controller.signal });
	};
	try {
		const source = await checkRequirements({
			sourceId: sourceIdForExtension(loaded.extension),
			label: loaded.extension.label ?? loaded.extension.id,
			requirements: extensionRequirements(loaded.runtime),
			credentials: loaded.credentials,
			signal: controller.signal,
		});
		return {
			workflow,
			paths,
			source,
			takeExtensionBundle: () => {
				if (closed) throw new Error("Workflow preparation is closed");
				if (transferred)
					throw new Error("Workflow preparation was already consumed");
				transferred = true;
				controller.abort();
				return makePlotExtensionSourceBundle({
					extension: loaded.extension,
					runtime: loaded.runtime,
					credentials: loaded.credentials,
					workflow,
					paths,
					config: loaded.config,
					tools: loaded.tools,
					maxConcurrentRuns: workflow.runtime.extension?.maxConcurrentRuns,
				});
			},
			close,
		};
	} catch (error) {
		await close().catch(() => undefined);
		throw error;
	}
};

export const prepareWorkflow = async (
	options: PrepareWorkflowOptions,
): Promise<PreparedWorkflow> => {
	const run = () => prepare(options);
	try {
		return await (options.diagnostic === undefined
			? run()
			: withScopedConsole(options.diagnostic, run));
	} catch (error) {
		if (error instanceof WorkflowBoundaryError) throw error;
		throw new WorkflowBoundaryError({
			phase: "prepare",
			path: resolveWorkflowPath(options),
			message: errorMessage(error),
		});
	}
};
