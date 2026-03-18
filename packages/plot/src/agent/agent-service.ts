import { ServiceMap, type Stream } from "effect";
import type { AgentRuntimeEvent } from "@plot/sdk";
import type { AgentRunnerError } from "../schemas/errors.js";

export interface AgentRunConfig {
	readonly systemPrompt: string;
	readonly prompt: string;
	readonly workspacePath: string;
	readonly issueId: string;
	readonly issueIdentifier: string;
	readonly maxTurns: number;
	readonly turnTimeoutMs: number;
	readonly stallTimeoutMs: number;
	readonly modelSpec?: string;
}

export interface AgentServiceShape {
	readonly run: (
		config: AgentRunConfig,
	) => Stream.Stream<AgentRuntimeEvent, AgentRunnerError>;
}

export class AgentService extends ServiceMap.Service<AgentService, AgentServiceShape>()("AgentService") {}
