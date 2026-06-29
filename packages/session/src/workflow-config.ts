import { Schema } from "effect";
import {
	NonEmptyString,
	PositiveInteger,
	decodeBoundary,
	optional,
} from "./schema.js";

const stringArray = Schema.Array(NonEmptyString);

export const agentToolModeSchema = Schema.Union([
	Schema.Boolean,
	Schema.Literal("all"),
	Schema.Literal("builtin"),
]);

export const workflowAgentConfigSchema = Schema.Struct({
	provider: optional(NonEmptyString),
	model: optional(NonEmptyString),
	thinking: optional(
		Schema.Literals(["off", "minimal", "low", "medium", "high", "xhigh"]),
	),
	tools: optional(stringArray),
	excludeTools: optional(stringArray),
	noTools: optional(agentToolModeSchema),
	allowProjectConfig: optional(Schema.Boolean),
	maxTurns: optional(PositiveInteger),
});

export const workflowPlotConfigSchema = Schema.Struct({
	tickIntervalMs: optional(PositiveInteger),
	maxRunDurationMs: optional(PositiveInteger),
	stallTimeoutMs: optional(PositiveInteger),
	queueCapacity: optional(PositiveInteger),
	eventCapacity: optional(PositiveInteger),
	eventBufferCapacity: optional(PositiveInteger),
});

export const workflowResourcesConfigSchema = Schema.Struct({
	skills: optional(stringArray),
	prompts: optional(stringArray),
	contextFiles: optional(Schema.Boolean),
	systemPrompt: optional(Schema.String),
	appendSystemPrompt: optional(stringArray),
});

export const workflowExtensionConfigSchema = Schema.Struct({
	source: NonEmptyString,
	maxConcurrentRuns: optional(PositiveInteger),
	config: optional(Schema.Unknown),
});

export const workflowRuntimeConfigSchema = Schema.Struct({
	name: optional(NonEmptyString),
	plot: optional(workflowPlotConfigSchema),
	agent: optional(workflowAgentConfigSchema),
	resources: optional(workflowResourcesConfigSchema),
	extension: optional(workflowExtensionConfigSchema),
});

export type WorkflowRuntimeConfig = typeof workflowRuntimeConfigSchema.Type;

export const decodeWorkflowRuntimeConfig = (
	value: unknown,
): WorkflowRuntimeConfig =>
	decodeBoundary(workflowRuntimeConfigSchema, value ?? {});
