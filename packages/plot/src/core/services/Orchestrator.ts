import type { Effect, Scope, Stream } from "effect";
import { ServiceMap } from "effect";
import type {
	AgentRuntimeEvent,
	IssueEventLog,
	IssueNotFound,
	OrchestratorUnavailable,
	RefreshResult,
	RuntimeSnapshot,
} from "@plot/sdk";
import type { OrchestratorState } from "../domain/orchestrator-state.js";
import type { ResolvedConfig } from "../config-service.js";

export interface OrchestratorShape {
	readonly start: (workflowPath: string) => Effect.Effect<void, never, Scope.Scope>;
	readonly tick: Effect.Effect<void, never>;
	readonly getState: Effect.Effect<OrchestratorState>;
	readonly getConfig: Effect.Effect<ResolvedConfig | null>;
	readonly getCommandQueueDepth: Effect.Effect<number>;
	readonly eventStream: Stream.Stream<AgentRuntimeEvent>;
	readonly stateStream: Stream.Stream<OrchestratorState>;
	readonly snapshotStream: Stream.Stream<RuntimeSnapshot>;
	readonly getSnapshot: Effect.Effect<RuntimeSnapshot, OrchestratorUnavailable>;
	readonly getEventLog: (
		identifier: string,
	) => Effect.Effect<IssueEventLog, IssueNotFound | OrchestratorUnavailable>;
	readonly triggerRefresh: Effect.Effect<RefreshResult, OrchestratorUnavailable>;
}

export class Orchestrator extends ServiceMap.Service<Orchestrator, OrchestratorShape>()(
	"Orchestrator",
) {}
