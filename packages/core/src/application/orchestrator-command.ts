import type { Exit } from "effect";
import type { AgentRuntimeEvent } from "@plot/contracts";
import type { ResolvedConfig } from "../config-service.js";

export interface TickCommand {
	readonly _tag: "tick";
	readonly reason: string;
	readonly coalesced: boolean;
}

export interface RuntimeEventCommand {
	readonly _tag: "runtime_event";
	readonly event: AgentRuntimeEvent;
}

export interface WorkerExitCommand {
	readonly _tag: "worker_exit";
	readonly issueId: string;
	readonly identifier: string;
	readonly attempt: number | null;
	readonly config: ResolvedConfig;
	readonly workspacePath: string;
	readonly exit: Exit.Exit<void, unknown>;
}

export interface RetryDueCommand {
	readonly _tag: "retry_due";
	readonly issueId: string;
	readonly attempt: number;
}

export type OrchestratorCommand =
	| TickCommand
	| RuntimeEventCommand
	| WorkerExitCommand
	| RetryDueCommand;

export const CONTINUATION_DELAY_MS = 5_000;
export const COMMAND_QUEUE_CAPACITY = 1_024;
export const COMMAND_QUEUE_PRESSURE_WARN_AT = 768;

export const computeRetryDelay = (
	attempt: number,
	maxBackoffMs: number,
): number => Math.min(10_000 * Math.pow(2, attempt - 1), maxBackoffMs);
