import type { ToolDefinition as AgentToolDefinition } from "@earendil-works/pi-coding-agent";
import { isRecord } from "@plot/common/primitives";
import type {
	ExtensionTool,
	ExtensionWork,
	JsonSchema,
	ToolContext,
	ToolDefinition,
	ToolExecutionContext,
} from "@plot/sdk";
import type { SessionPaths } from "./paths.js";

const normalizeArguments = (schema: JsonSchema, value: unknown): unknown => {
	if (schema.type === "object") {
		const normalized: Record<string, unknown> = {};
		if (!isRecord(value)) return normalized;
		for (const [key, property] of Object.entries(schema.properties ?? {}))
			if (value[key] !== undefined)
				normalized[key] = normalizeArguments(property, value[key]);
		return normalized;
	}
	if (schema.type === "array" && schema.items && Array.isArray(value))
		return value.map((item) => normalizeArguments(schema.items!, item));
	return value;
};

const toAgentTool = (
	tool: ToolDefinition,
	onError?: (error: unknown) => Promise<void> | void,
): AgentToolDefinition<never, unknown> =>
	({
		name: tool.name,
		label: tool.label,
		description: tool.description,
		parameters: tool.parameters,
		promptSnippet: tool.promptSnippet,
		promptGuidelines: tool.promptGuidelines
			? [...tool.promptGuidelines]
			: undefined,
		executionMode: tool.executionMode,
		prepareArguments: (args: unknown) =>
			normalizeArguments(tool.parameters, args),
		execute: async (
			_toolCallId: string,
			params: unknown,
			signal: AbortSignal | undefined,
		) => {
			try {
				const result = await tool.execute(
					normalizeArguments(tool.parameters, params) as Record<
						string,
						unknown
					>,
					{ signal } as ToolExecutionContext,
				);
				return {
					content: [...result.content],
					details: result.details,
					terminate: result.terminate,
				};
			} catch (error) {
				await onError?.(error);
				throw error;
			}
		},
	}) as unknown as AgentToolDefinition<never, unknown>;

export const resolveToolDefinitions = async (options: {
	readonly tools: readonly ExtensionTool[];
	readonly workflow: unknown;
	readonly paths: SessionPaths;
	readonly config: unknown;
	readonly work: ExtensionWork;
	readonly runId: string;
	readonly onError?: (error: unknown) => Promise<void> | void;
}): Promise<AgentToolDefinition[]> => {
	const context: ToolContext = {
		workflow: options.workflow,
		paths: options.paths,
		config: options.config,
		work: options.work,
		runId: options.runId,
	};
	const tools = await Promise.all(
		options.tools.map(async (tool) =>
			typeof tool === "function" ? await tool(context) : tool,
		),
	);
	const names = new Set<string>();
	for (const tool of tools) {
		if (names.has(tool.name))
			throw new Error(`duplicate extension tool name: ${tool.name}`);
		names.add(tool.name);
	}
	return tools.map((tool) => toAgentTool(tool, options.onError));
};
