import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { isRecord } from "@plot/common/primitives";
import type { SessionPaths } from "../paths.js";
import type {
	PlotExtensionTool,
	PlotExtensionWork,
	PlotJsonSchema,
	PlotToolContext,
	PlotToolDefinition,
} from "../sdk.js";
import type { WorkflowDefinition } from "../workflow.js";
import { PlotExtensionSourceError } from "./errors.js";

const normalizeToolArguments = (
	schema: PlotJsonSchema,
	value: unknown,
): unknown => {
	if (schema.type === "object") {
		const normalized: Record<string, unknown> = {};
		if (!isRecord(value)) return normalized;
		for (const [key, propertySchema] of Object.entries(
			schema.properties ?? {},
		)) {
			if (value[key] !== undefined)
				normalized[key] = normalizeToolArguments(propertySchema, value[key]);
		}
		return normalized;
	}
	if (schema.type === "array" && Array.isArray(value)) {
		if (schema.items === undefined) return value;
		return value.map((item) => normalizeToolArguments(schema.items!, item));
	}
	return value;
};

const toPiToolDefinition = (
	tool: PlotToolDefinition,
): ToolDefinition<never, unknown> => ({
	name: tool.name,
	label: tool.label,
	description: tool.description,
	parameters: tool.parameters as never,
	prepareArguments: (args) =>
		normalizeToolArguments(tool.parameters, args) as never,
	...(tool.promptSnippet === undefined
		? {}
		: { promptSnippet: tool.promptSnippet }),
	...(tool.promptGuidelines === undefined
		? {}
		: { promptGuidelines: [...tool.promptGuidelines] }),
	...(tool.executionMode === undefined
		? {}
		: { executionMode: tool.executionMode }),
	execute: async (_toolCallId, params, signal) => {
		const context = signal === undefined ? {} : { signal };
		const normalizedParams = normalizeToolArguments(tool.parameters, params);
		const result = await tool.execute(
			normalizedParams as Record<string, unknown>,
			context,
		);
		return {
			content: [...result.content],
			details: result.details,
			...(result.terminate === undefined
				? {}
				: { terminate: result.terminate }),
		};
	},
});

export const resolveToolDefinitions = async (options: {
	readonly tools: readonly PlotExtensionTool[];
	readonly workflow: WorkflowDefinition;
	readonly paths: SessionPaths;
	readonly config: unknown;
	readonly work: PlotExtensionWork;
	readonly runId?: string;
}): Promise<ToolDefinition[]> => {
	const context: PlotToolContext = {
		workflow: options.workflow,
		paths: options.paths,
		config: options.config,
		work: options.work,
		...(options.runId === undefined ? {} : { runId: options.runId }),
	};
	const resolved = await Promise.all(
		options.tools.map((tool) =>
			typeof tool === "function" ? Promise.resolve(tool(context)) : tool,
		),
	);
	const names = new Set<string>();
	for (const tool of resolved) {
		if (names.has(tool.name))
			throw new PlotExtensionSourceError({
				phase: "create",
				message: `duplicate extension tool name: ${tool.name}`,
			});
		names.add(tool.name);
	}
	return resolved.map(toPiToolDefinition);
};
