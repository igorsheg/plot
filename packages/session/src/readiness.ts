import type { SourceRecord } from "@plot/agent/model";
import type { ExtensionInteraction } from "@plot/sdk";
import type { SessionPaths } from "./paths.js";
import type { WorkflowDefinition } from "./workflow.js";
import {
	checkRequirements,
	extensionRequirements,
	sourceIdForExtension,
} from "./extension-source.js";
import { loadPlotExtensionRuntimeFromWorkflow } from "./extension-loader.js";

export class ExtensionSetupRequiredError extends Error {
	override readonly name = "ExtensionSetupRequiredError";
	readonly source: SourceRecord;

	constructor(source: SourceRecord) {
		const requirements = source.requirements
			.filter((requirement) => requirement.status === "action-required")
			.map((requirement) => requirement.label)
			.join(", ");
		super(`extension ${source.label} requires setup: ${requirements}`);
		this.source = source;
	}
}

export interface InspectWorkflowReadinessOptions {
	readonly workflow: WorkflowDefinition;
	readonly paths: SessionPaths;
	readonly signal?: AbortSignal;
}

/** Loads an extension and runs only its cheap, local requirement checks. */
export const inspectWorkflowExtensionReadiness = async (
	options: InspectWorkflowReadinessOptions,
): Promise<SourceRecord> => {
	const loaded = await loadPlotExtensionRuntimeFromWorkflow(options);
	const controller =
		options.signal === undefined ? new AbortController() : undefined;
	const signal = options.signal ?? controller!.signal;
	try {
		return await checkRequirements({
			sourceId: sourceIdForExtension(loaded.extension),
			label: loaded.extension.label ?? loaded.extension.id,
			requirements: extensionRequirements(loaded.runtime),
			credentials: loaded.credentials,
			signal,
		});
	} finally {
		controller?.abort();
		await loaded.runtime.shutdown?.({ signal });
	}
};

export interface RunWorkflowExtensionActionOptions extends InspectWorkflowReadinessOptions {
	readonly requirementId: string;
	readonly actionId: string;
	readonly interaction: ExtensionInteraction;
}

export const runWorkflowExtensionAction = async (
	options: RunWorkflowExtensionActionOptions,
): Promise<SourceRecord> => {
	const loaded = await loadPlotExtensionRuntimeFromWorkflow(options);
	const controller =
		options.signal === undefined ? new AbortController() : undefined;
	const signal = options.signal ?? controller!.signal;
	try {
		const requirements = extensionRequirements(loaded.runtime);
		const requirement = requirements.find(
			(candidate) => candidate.id === options.requirementId,
		);
		if (requirement === undefined)
			throw new Error(
				`unknown extension requirement: ${options.requirementId}`,
			);
		const before = await checkRequirements({
			sourceId: sourceIdForExtension(loaded.extension),
			label: loaded.extension.label ?? loaded.extension.id,
			requirements,
			credentials: loaded.credentials,
			signal,
		});
		const state = before.requirements.find(
			(candidate) => candidate.id === requirement.id,
		);
		if (state?.status !== "action-required")
			throw new Error(
				`extension requirement ${requirement.id} needs no action`,
			);
		if (!state.actions?.some((action) => action.id === options.actionId))
			throw new Error(
				`unknown action ${options.actionId} for extension requirement ${requirement.id}`,
			);
		if (requirement.action === undefined)
			throw new Error(
				`extension requirement ${requirement.id} has no action hook`,
			);
		await requirement.action({
			actionId: options.actionId,
			signal,
			credentials: loaded.credentials,
			interaction: options.interaction,
		});
		return await checkRequirements({
			sourceId: sourceIdForExtension(loaded.extension),
			label: loaded.extension.label ?? loaded.extension.id,
			requirements,
			credentials: loaded.credentials,
			signal,
		});
	} finally {
		controller?.abort();
		await loaded.runtime.shutdown?.({ signal });
	}
};
