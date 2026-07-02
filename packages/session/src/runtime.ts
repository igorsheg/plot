import type { AgentEventInput, RuntimeEvent } from "./runtime-event.js";

export interface SessionSnapshot {
	readonly sessionId: string;
	readonly work?: unknown;
	readonly running?: unknown;
	readonly facts?: unknown;
}

export interface SessionTickResult {
	readonly tickId: number;
	readonly selectedCount: number;
	readonly startedCount: number;
	readonly runningCount: number;
	readonly completionCount: number;
	readonly diagnosticCount: number;
	readonly diagnostics?: readonly unknown[];
}

export interface InterruptAgentRunInput {
	readonly runId: string;
	readonly workKey?: string;
}

/** A human decision on a Work Item, recorded so Sources reconcile with it. */
export interface OperatorObservationInput {
	readonly sourceId: string;
	readonly workKey: string;
	readonly actionId: string;
	readonly actionLabel: string;
	readonly comment?: string | undefined;
	readonly clientId?: string | undefined;
	readonly actor?: string | undefined;
}

export interface SessionRuntimeState {
	readonly sessionId: string;
	readonly workflowName?: string | undefined;
	readonly workflowPath?: string | undefined;
	readonly cwd?: string | undefined;
	readonly cwdName?: string | undefined;
	readonly sessionDir?: string | undefined;
	readonly lastSequence?: number | undefined;
}

export interface SessionRuntime {
	readonly id: string;
	readonly start: () => Promise<void>;
	readonly tickOnce: () => Promise<SessionTickResult>;
	readonly state: () => Promise<SessionRuntimeState>;
	readonly snapshot: () => Promise<SessionSnapshot>;
	readonly pauseDispatch: () => Promise<void>;
	readonly resumeDispatch: () => Promise<void>;
	readonly interruptAgentRun: (
		input: InterruptAgentRunInput,
	) => Promise<boolean>;
	readonly recordOperatorObservation: (
		input: OperatorObservationInput,
	) => Promise<boolean>;
	readonly events: () => AsyncIterable<RuntimeEvent>;
	readonly appendAgentEvent: (input: AgentEventInput) => Promise<RuntimeEvent>;
	readonly lastEventSequence: () => Promise<number>;
	readonly shutdown: () => Promise<boolean>;
}

export interface OwnedTask {
	readonly name: string;
	readonly done: Promise<void>;
	readonly stop: () => void | Promise<void>;
}

export const startOwnedTask = (input: {
	readonly name: string;
	readonly run: (signal: AbortSignal) => Promise<void>;
	readonly onError?: (error: unknown) => void | Promise<void>;
}): OwnedTask => {
	const controller = new AbortController();
	const done = input.run(controller.signal).catch(async (error) => {
		if (controller.signal.aborted) return;
		await input.onError?.(error);
	});
	return {
		name: input.name,
		done,
		stop: () => controller.abort(),
	};
};
