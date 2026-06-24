import type { ActivityKind, AttemptStage, WorkCheck } from "./projection.js";

export interface PiUsageDelta {
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

const record = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const numberAt = (
	record: Record<string, unknown>,
	...keys: readonly string[]
) => {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "number") return value;
	}
	return undefined;
};
const usageDelta = (
	event: Record<string, unknown>,
): PiUsageDelta | undefined => {
	const message = record(event["message"]) ? event["message"] : undefined;
	const usage = record(message?.["usage"])
		? message["usage"]
		: record(event["usage"])
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
	const cost = record(usage["cost"])
		? numberAt(usage["cost"], "total")
		: undefined;
	return {
		...(input === undefined ? {} : { input }),
		...(output === undefined ? {} : { output }),
		total,
		...(cost === undefined ? {} : { cost }),
	};
};
const oneLine = (value: string) =>
	value
		.replace(
			/[\u001B\u009B][[\]()#;?]*(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><]/g,
			"",
		)
		.replace(/[\r\n\t]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
const truncate = (value: string, max = 96) =>
	value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`;
const contentText = (value: unknown, kind: "thinking" | "text") => {
	const partial = record(value) ? value : undefined;
	const content = Array.isArray(partial?.["content"]) ? partial["content"] : [];
	const match = content.find(
		(item): item is Record<string, unknown> =>
			record(item) && item["type"] === kind,
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
	const partial = record(update?.["partial"]) ? update["partial"] : undefined;
	const content = Array.isArray(partial?.["content"]) ? partial["content"] : [];
	const index = numberAt(update ?? {}, "contentIndex");
	const item =
		index === undefined
			? content.find((value) => record(value) && value["type"] === "toolCall")
			: content[index];
	if (!record(item) || item["type"] !== "toolCall") return undefined;
	return {
		name: str(item["name"]),
		args: record(item["arguments"]) ? item["arguments"] : {},
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
	const update = record(event["assistantMessageEvent"])
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
		const args = record(event["args"]) ? event["args"] : {};
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
