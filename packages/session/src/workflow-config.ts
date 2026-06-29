import { z } from "zod";

const positiveInteger = z.number().int().positive();
const stringArray = z.array(z.string().min(1));

export const agentToolModeSchema = z.union([
	z.boolean(),
	z.literal("all"),
	z.literal("builtin"),
]);

export const workflowAgentConfigSchema = z
	.object({
		provider: z.string().min(1).optional(),
		model: z.string().min(1).optional(),
		thinking: z
			.enum(["off", "minimal", "low", "medium", "high", "xhigh"])
			.optional(),
		tools: stringArray.optional(),
		excludeTools: stringArray.optional(),
		noTools: agentToolModeSchema.optional(),
		allowProjectConfig: z.boolean().optional(),
		maxTurns: positiveInteger.optional(),
	})
	.strict();

export const workflowPlotConfigSchema = z
	.object({
		tickIntervalMs: positiveInteger.optional(),
		maxRunDurationMs: positiveInteger.optional(),
		stallTimeoutMs: positiveInteger.optional(),
		queueCapacity: positiveInteger.optional(),
		eventCapacity: positiveInteger.optional(),
		eventBufferCapacity: positiveInteger.optional(),
	})
	.strict();

export const workflowResourcesConfigSchema = z
	.object({
		skills: stringArray.optional(),
		prompts: stringArray.optional(),
		contextFiles: z.boolean().optional(),
		systemPrompt: z.string().optional(),
		appendSystemPrompt: stringArray.optional(),
	})
	.strict();

export const workflowExtensionConfigSchema = z
	.object({
		source: z.string().min(1),
		maxConcurrentRuns: positiveInteger.optional(),
		config: z.unknown().optional(),
	})
	.strict();

export const workflowRuntimeConfigSchema = z
	.object({
		name: z.string().min(1).optional(),
		plot: workflowPlotConfigSchema.optional(),
		agent: workflowAgentConfigSchema.optional(),
		resources: workflowResourcesConfigSchema.optional(),
		extension: workflowExtensionConfigSchema.optional(),
	})
	.strict();

export type WorkflowRuntimeConfig = z.infer<typeof workflowRuntimeConfigSchema>;

export const decodeWorkflowRuntimeConfig = (
	value: unknown,
): WorkflowRuntimeConfig => workflowRuntimeConfigSchema.parse(value ?? {});
