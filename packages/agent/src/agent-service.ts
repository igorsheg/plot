import { Context, Effect, type Stream } from "effect";
import type { AgentRuntimeEvent } from "@plot/shared";
import type { AgentRunnerError } from "@plot/shared";

export interface AgentRunConfig {
	readonly systemPrompt: string;
	readonly prompt: string;
	readonly workspacePath: string;
	readonly issueId: string;
	readonly issueIdentifier: string;
	readonly maxTurns: number;
	readonly turnTimeoutMs: number;
	readonly shouldContinue?: () => Effect.Effect<boolean>;
}

export interface AgentServiceShape {
	readonly run: (
		config: AgentRunConfig,
		signal: AbortSignal,
	) => Stream.Stream<AgentRuntimeEvent, AgentRunnerError>;
}

export class AgentService extends Context.Tag("AgentService")<
	AgentService,
	AgentServiceShape
>() {}
