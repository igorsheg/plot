import { Context, Effect, type Stream } from "effect";
import type { AgentRuntimeEvent, PluginToolDefinition } from "@plot/sdk";
import type { AgentRunnerError } from "../schemas/errors.js";

export interface AgentRunConfig {
	readonly systemPrompt: string;
	readonly prompt: string;
	readonly workspacePath: string;
	readonly issueId: string;
	readonly issueIdentifier: string;
	readonly pluginSkillPaths: ReadonlyArray<string>;
	readonly pluginTools: ReadonlyArray<PluginToolDefinition>;
	readonly maxTurns: number;
	readonly turnTimeoutMs: number;
	readonly shouldContinue?: () => Effect.Effect<boolean>;
}

export interface AgentServiceShape {
	readonly run: (
		config: AgentRunConfig,
	) => Stream.Stream<AgentRuntimeEvent, AgentRunnerError>;
}

export class AgentService extends Context.Tag("AgentService")<
	AgentService,
	AgentServiceShape
>() {}
