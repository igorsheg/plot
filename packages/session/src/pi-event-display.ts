import { isRecord } from "@plot/common/primitives";
import type {
	ActivityKind,
	AttemptStage,
	WorkCheck,
} from "./projection-parts/types.js";

export interface PiUsageDelta {
	readonly key?: string | undefined;
	readonly input?: number | undefined;
	readonly output?: number | undefined;
	readonly total: number;
	readonly cost?: number | undefined;
}

export type PiDisplayEvent =
	| { readonly type: "turn_start"; readonly summary: string }
	| {
			readonly type: "turn_end";
			readonly summary: string;
			readonly usage?: PiUsageDelta | undefined;
	  }
	| {
			readonly type: "thinking";
			readonly summary: string;
			readonly delta: string;
	  }
	| {
			readonly type: "message";
			readonly summary: string;
			readonly delta: string;
	  }
	| {
			readonly type: "tool_start" | "tool_update";
			readonly tool: PiToolDisplay;
	  }
	| {
			readonly type: "tool_end";
			readonly toolCallId?: string | undefined;
			readonly failed: boolean;
	  };

export interface PiToolDisplay {
	readonly kind: ActivityKind;
	readonly stage: AttemptStage;
	readonly text: string;
	readonly check: WorkCheck;
	readonly target?: string | undefined;
	readonly toolCallId?: string | undefined;
}

const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const numberAt = (
	input: Record<string, unknown>,
	...keys: readonly string[]
) => {
	for (const key of keys) {
		const value = input[key];
		if (typeof value === "number") return value;
	}
	return undefined;
};
const usageDelta = (
	event: Record<string, unknown>,
): PiUsageDelta | undefined => {
	const message = isRecord(event["message"]) ? event["message"] : undefined;
	const usage = isRecord(message?.["usage"])
		? message["usage"]
		: isRecord(event["usage"])
			? event["usage"]
			: undefined;
	if (usage === undefined) return undefined;
	const input = numberAt(usage, "input", "inputTokens");
	const output = numberAt(usage, "output", "outputTokens");
	const total =
		numberAt(usage, "totalTokens", "total") ??
		(input !== undefined || output !== undefined
			? (input ?? 0) + (output ?? 0)
			: undefined);
	if (total === undefined) return undefined;
	const cost = isRecord(usage["cost"])
		? numberAt(usage["cost"], "total")
		: undefined;
	const key =
		str(message?.["responseId"]) ??
		(typeof message?.["timestamp"] === "number"
			? String(message["timestamp"])
			: undefined);
	return {
		...(key === undefined ? {} : { key }),
		...(input === undefined ? {} : { input }),
		...(output === undefined ? {} : { output }),
		total,
		...(cost === undefined ? {} : { cost }),
	};
};
const ansiPattern = new RegExp(
	`[${String.fromCharCode(27)}\u009B][[\\]()#;?]*(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><]`,
	"g",
);

const oneLine = (value: string) =>
	value
		.replace(ansiPattern, "")
		.replace(/[\r\n\t]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
const truncate = (value: string, max = 96) =>
	value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`;
const compactStringField = (key: string, value: unknown) =>
	typeof value === "string" ? { [key]: value } : {};
const compactBooleanField = (key: string, value: unknown) =>
	typeof value === "boolean" ? { [key]: value } : {};
const compactNumberField = (key: string, value: unknown) =>
	typeof value === "number" ? { [key]: value } : {};

const compactToolArgs = (value: unknown): Record<string, unknown> => {
	const args = isRecord(value) ? value : {};
	return {
		...compactStringField("command", args["command"]),
		...compactStringField("path", args["path"]),
		...compactStringField("pattern", args["pattern"]),
	};
};

const compactUsage = (value: unknown): Record<string, unknown> | undefined => {
	const usage = isRecord(value) ? value : undefined;
	if (usage === undefined) return undefined;
	return {
		...compactNumberField("input", usage["input"]),
		...compactNumberField("inputTokens", usage["inputTokens"]),
		...compactNumberField("output", usage["output"]),
		...compactNumberField("outputTokens", usage["outputTokens"]),
		...compactNumberField("total", usage["total"]),
		...compactNumberField("totalTokens", usage["totalTokens"]),
		...(isRecord(usage["cost"])
			? { cost: compactNumberField("total", usage["cost"]["total"]) }
			: {}),
	};
};

const compactContentItem = (value: unknown): unknown => {
	if (!isRecord(value)) return value;
	const type = str(value["type"]);
	if (type === "thinking")
		return { type, ...compactStringField("thinking", value["thinking"]) };
	if (type === "text")
		return { type, ...compactStringField("text", value["text"]) };
	if (type === "toolCall")
		return {
			type,
			...compactStringField("id", value["id"]),
			...compactStringField("name", value["name"]),
			arguments: compactToolArgs(value["arguments"]),
		};
	return type === undefined ? {} : { type };
};

const compactPartial = (
	value: unknown,
): Record<string, unknown> | undefined => {
	const partial = isRecord(value) ? value : undefined;
	if (partial === undefined) return undefined;
	return Array.isArray(partial["content"])
		? { content: partial["content"].map(compactContentItem) }
		: {};
};

const compactAssistantMessageEvent = (
	value: unknown,
): Record<string, unknown> | undefined => {
	const update = isRecord(value) ? value : undefined;
	if (update === undefined) return undefined;
	const partial = compactPartial(update["partial"]);
	return {
		...compactStringField("type", update["type"]),
		...compactStringField("delta", update["delta"]),
		...compactNumberField("contentIndex", update["contentIndex"]),
		...(partial === undefined ? {} : { partial }),
	};
};

const compactMessage = (
	value: unknown,
): Record<string, unknown> | undefined => {
	const message = isRecord(value) ? value : undefined;
	if (message === undefined) return undefined;
	const usage = compactUsage(message["usage"]);
	return {
		...compactStringField("responseId", message["responseId"]),
		...compactNumberField("timestamp", message["timestamp"]),
		...(usage === undefined ? {} : { usage }),
	};
};

export const compactPiEvent = (value: unknown): Record<string, unknown> => {
	const event = isRecord(value) ? value : {};
	const usage = compactUsage(event["usage"]);
	const message = compactMessage(event["message"]);
	const assistantMessageEvent = compactAssistantMessageEvent(
		event["assistantMessageEvent"],
	);
	return {
		...compactStringField("type", event["type"]),
		...compactStringField("toolName", event["toolName"]),
		...compactStringField("toolCallId", event["toolCallId"]),
		...compactStringField("text", event["text"]),
		...compactStringField("content", event["content"]),
		...compactBooleanField("isError", event["isError"]),
		...(isRecord(event["args"])
			? { args: compactToolArgs(event["args"]) }
			: {}),
		...(usage === undefined ? {} : { usage }),
		...(message === undefined ? {} : { message }),
		...(assistantMessageEvent === undefined ? {} : { assistantMessageEvent }),
	};
};

const contentText = (value: unknown, kind: "thinking" | "text") => {
	const partial = isRecord(value) ? value : undefined;
	const content = Array.isArray(partial?.["content"]) ? partial["content"] : [];
	const match = content.find(
		(item): item is Record<string, unknown> =>
			isRecord(item) && item["type"] === kind,
	);
	return kind === "thinking" ? str(match?.["thinking"]) : str(match?.["text"]);
};
const proseSummary = (
	prefix: string,
	update: Record<string, unknown> | undefined,
	kind: "thinking" | "text",
) => {
	const text = oneLine(
		contentText(update?.["partial"], kind) ?? str(update?.["delta"]) ?? "",
	);
	return text.length === 0 ? prefix : `${prefix}: ${truncate(text)}`;
};
const partialToolCall = (update: Record<string, unknown> | undefined) => {
	const partial = isRecord(update?.["partial"]) ? update["partial"] : undefined;
	const content = Array.isArray(partial?.["content"]) ? partial["content"] : [];
	const index = numberAt(update ?? {}, "contentIndex");
	const item =
		index === undefined
			? content.find((value) => isRecord(value) && value["type"] === "toolCall")
			: content[index];
	if (!isRecord(item) || item["type"] !== "toolCall") return undefined;
	return {
		name: str(item["name"]),
		args: isRecord(item["arguments"]) ? item["arguments"] : {},
		toolCallId: str(item["id"]),
	};
};

export const appendStreamDelta = (
	previous: string | undefined,
	delta: string,
) => (previous === undefined ? delta : previous + delta);

const toolActivity = (
	name: string | undefined,
	args: Record<string, unknown>,
	toolCallId?: string | undefined,
): PiToolDisplay => {
	if (name === "read")
		return {
			kind: "read",
			stage: "working",
			text: `read ${str(args["path"]) ?? "file"}`,
			check: "not-run",
			target: str(args["path"]),
			toolCallId,
		};
	if (name === "grep" || name === "find" || name === "ls")
		return {
			kind: "search",
			stage: "working",
			text: `${name} ${str(args["pattern"]) ?? str(args["path"]) ?? ""}`.trim(),
			check: "not-run",
			toolCallId,
		};
	if (name === "edit" || name === "write")
		return {
			kind: "edit",
			stage: "working",
			text: `${name} ${str(args["path"]) ?? "file"}`,
			check: "not-run",
			target: str(args["path"]),
			toolCallId,
		};
	const command = str(args["command"]);
	if (name === "bash" && command !== undefined) {
		if (/\b(test|check|lint|typecheck|tsc|bun test|npm test)\b/.test(command))
			return {
				kind: "test",
				stage: "verifying",
				text: command,
				check: "running",
				target: command,
				toolCallId,
			};
		if (/\b(gh pr review|gh pr comment|git commit|npm publish)\b/.test(command))
			return {
				kind: "finish",
				stage: "finishing",
				text: command,
				check: "not-run",
				target: command,
				toolCallId,
			};
		return {
			kind: "run",
			stage: "working",
			text: command,
			check: "not-run",
			target: command,
			toolCallId,
		};
	}
	return {
		kind: "run",
		stage: "working",
		text: name ?? "tool",
		check: "not-run",
		toolCallId,
	};
};

export const piEventDisplay = (
	event: Record<string, unknown>,
): PiDisplayEvent | undefined => {
	const update = isRecord(event["assistantMessageEvent"])
		? event["assistantMessageEvent"]
		: undefined;
	const type = str(update?.["type"]) ?? str(event["type"]);
	if (type === "agent_start" || type === "turn_start")
		return { type: "turn_start", summary: "turn started" };
	if (type === "turn_end" || type === "agent_end" || type === "message_end") {
		const usage = usageDelta(event);
		return {
			type: "turn_end",
			summary:
				usage === undefined
					? "turn completed"
					: `turn completed (${usage.total} tokens)`,
			...(usage === undefined ? {} : { usage }),
		};
	}
	if (type === "thinking_delta")
		return {
			type: "thinking",
			summary: proseSummary("reasoning", update, "thinking"),
			delta: str(update?.["delta"]) ?? "",
		};
	if (
		type === "text_delta" ||
		type === "message_delta" ||
		type === "message_partial"
	)
		return {
			type: "message",
			summary: proseSummary("writing", update, "text"),
			delta:
				str(update?.["delta"]) ??
				str(event["text"]) ??
				str(event["content"]) ??
				"",
		};
	if (
		type === "toolcall_start" ||
		type === "toolcall_delta" ||
		type === "toolcall_end"
	) {
		const call = partialToolCall(update);
		return {
			type: type === "toolcall_start" ? "tool_start" : "tool_update",
			tool: toolActivity(call?.name, call?.args ?? {}, call?.toolCallId),
		};
	}
	if (type === "tool_execution_start" || type === "tool_execution_update") {
		const args = isRecord(event["args"]) ? event["args"] : {};
		return {
			type: type === "tool_execution_start" ? "tool_start" : "tool_update",
			tool: toolActivity(
				str(event["toolName"]),
				args,
				str(event["toolCallId"]),
			),
		};
	}
	if (type === "tool_execution_end")
		return {
			type: "tool_end",
			toolCallId: str(event["toolCallId"]),
			failed: event["isError"] === true,
		};
	return undefined;
};
