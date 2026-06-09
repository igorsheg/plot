import type { RuntimeSnapshot } from "@plot/agent/model";
import type { PlotPaths } from "./plot-paths.js";
import type { WorkflowDefinition } from "./workflow.js";

export type MaybePromise<A> = A | Promise<A>;

export interface PlotExtensionContext<Config = unknown> {
	readonly workflow: WorkflowDefinition;
	readonly paths: PlotPaths;
	readonly config: Config;
}

export interface PlotExtensionPhaseContext {
	readonly sourceId: string;
	readonly tickId: number;
	readonly snapshot: RuntimeSnapshot;
}

export interface PlotExtensionObservation {
	readonly type: string;
	readonly subject?: string;
	readonly data?: unknown;
}

export type PlotExtensionReconcileProposal =
	| {
			readonly type: "set_fact";
			readonly key: string;
			readonly value: unknown;
	  }
	| {
			readonly type: "remove_fact";
			readonly key: string;
	  }
	| {
			readonly type: "interrupt_work";
			readonly workKey: string;
			readonly reason?: string;
	  }
	| {
			readonly type: "schedule_wake";
			readonly delayMs: number;
			readonly reason?: string;
	  };

export interface PlotExtensionWorkItem {
	readonly workKey: string;
	readonly subject?: string;
	readonly templateContext?: unknown;
}

export interface PlotExtensionSource {
	readonly id: string;
	readonly observeTick?: (
		context: PlotExtensionPhaseContext,
	) => MaybePromise<readonly PlotExtensionObservation[]>;
	readonly reconcile?: (
		context: PlotExtensionPhaseContext,
	) => MaybePromise<readonly PlotExtensionReconcileProposal[]>;
	readonly selectWork?: (
		context: PlotExtensionPhaseContext,
	) => MaybePromise<readonly PlotExtensionWorkItem[]>;
}

export interface PlotExtensionInstance {
	readonly source: PlotExtensionSource;
	readonly shutdown?: () => MaybePromise<void>;
}

export interface PlotExtension<Config = unknown> {
	readonly id: string;
	readonly parseConfig?: (input: unknown) => MaybePromise<Config>;
	readonly setup: (
		context: PlotExtensionContext<Config>,
	) => MaybePromise<PlotExtensionInstance>;
}

export const definePlotExtension = <Config>(
	extension: PlotExtension<Config>,
): PlotExtension<Config> => extension;
