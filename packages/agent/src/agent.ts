import { makePlotAgentRuntime } from "./runtime.js";
import type {
	PlotAgentEvent,
	PlotAgentMessage,
	RuntimeSnapshot,
	TickResult,
} from "./model.js";
import type { WorkRunner } from "./work-runner.js";
import type { AgentPolicy, WorkSource } from "./work-source.js";

export interface PlotAgent {
	start: () => Promise<void>;
	run: () => Promise<void>;
	tickOnce: () => Promise<TickResult>;
	snapshot: () => Promise<RuntimeSnapshot>;
	events: () => AsyncIterable<PlotAgentEvent>;
	offer: (message: PlotAgentMessage) => Promise<boolean>;
	wakeAfter: (delayMs: number, reason?: string) => Promise<void>;
	interruptAgentRun: (input: {
		runId: string;
		workKey?: string;
	}) => Promise<boolean>;
	pauseDispatch: () => Promise<void>;
	resumeDispatch: () => Promise<void>;
	shutdown: () => Promise<boolean>;
}
export const PlotAgent = Symbol("PlotAgent");
export interface PlotAgentLayerOptions {
	sources: WorkSource[];
	runner: WorkRunner;
	policy?: AgentPolicy;
	queueCapacity?: number;
	eventCapacity?: number;
	historyLimit?: number;
	/** Scheduler poll cadence. Default: 30s. */
	tickIntervalMs?: number;
	maxRunDurationMs?: number;
	/** Interrupt a run after this much time with no emitted observations. */
	stallTimeoutMs?: number;
}

export const makePlotAgentLayer = (options: PlotAgentLayerOptions): PlotAgent =>
	makePlotAgentRuntime(options);
