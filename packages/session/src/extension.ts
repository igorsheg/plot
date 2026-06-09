import type { Effect, Schema } from "effect";
import type { WorkSource } from "@plot/agent/work-source";
import type { PlotPaths } from "./plot-paths.js";
import type { WorkflowDefinition } from "./workflow.js";

export interface PlotExtensionContext<Config = unknown> {
	readonly workflow: WorkflowDefinition;
	readonly paths: PlotPaths;
	readonly config: Config;
}

export interface PlotExtensionInstance {
	readonly source: WorkSource;
	readonly shutdown?: Effect.Effect<void, unknown>;
}

export interface PlotExtension<Config = unknown> {
	readonly id: string;
	readonly config?: Schema.Schema<Config>;
	readonly setup: (
		context: PlotExtensionContext<Config>,
	) => Effect.Effect<PlotExtensionInstance, unknown>;
}

export const definePlotExtension = <Config>(
	extension: PlotExtension<Config>,
): PlotExtension<Config> => extension;
