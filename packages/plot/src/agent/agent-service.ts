import { Schema, ServiceMap, type Stream } from "effect";
import type { AgentRuntimeEvent } from "@plot/sdk";

export class AgentRunnerError extends Schema.TaggedErrorClass<AgentRunnerError>()(
	"AgentRunnerError",
	{
		code: Schema.String,
		message: Schema.String,
		cause: Schema.optional(Schema.Defect),
	},
) {
	override get message(): string {
		return `Agent runner failed [${this.code}]: ${this.message}`;
	}
}

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

export class AgentService extends ServiceMap.Service<
	AgentService,
	AgentServiceShape
>()("AgentService") {}
