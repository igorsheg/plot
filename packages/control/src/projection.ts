import { z } from "zod";
import { operatorActionSchema } from "./operator.js";
import type { PlotServerRecord } from "./protocol.js";
import type { SessionHistoryEvent } from "./session-history.js";
import { nonNegativeIntegerSchema } from "./session-summary.js";

export const dashboardStatusSchema = z.enum([
	"starting",
	"idle",
	"running",
	"shutting_down",
	"paused",
	"stopped",
	"error",
]);
export type DashboardStatus = z.infer<typeof dashboardStatusSchema>;
export type TuiStatus = DashboardStatus;

export const workStatusSchema = z.enum([
	"pending",
	"running",
	"blocked",
	"draining",
	"done",
	"failed",
]);
export type WorkStatus = z.infer<typeof workStatusSchema>;

export const attemptStageSchema = z.enum([
	"starting",
	"working",
	"verifying",
	"finishing",
	"failed",
]);
export type AttemptStage = z.infer<typeof attemptStageSchema>;

// The agent can only ever call pi-mono's closed builtin tool set
// (bash, edit, find, grep, ls, read, write). Every streamed event therefore
// classifies into one of a small, fixed taxonomy — no substring inference.
export const activityKindSchema = z.enum([
	"think", // turn boundaries / reasoning
	"read", // read tool
	"edit", // edit + write tools
	"search", // grep + find + ls tools
	"run", // bash (general command)
	"test", // bash running a check/test command
	"finish", // bash posting/publishing the result
	"message", // assistant message streaming (volatile)
	"wait", // queued / idle
]);
export type ActivityKind = z.infer<typeof activityKindSchema>;

// One coalesced run of consecutive same-kind activity. The spine and the
// kind-chips are projections of this; `count` survives even when individual
// timeline entries fall off the bounded tail.
export const phaseEntrySchema = z
	.object({
		kind: activityKindSchema,
		count: nonNegativeIntegerSchema,
		startedAtMs: nonNegativeIntegerSchema,
		target: z.string().optional(),
	})
	.strict();
export type PhaseEntry = z.infer<typeof phaseEntrySchema>;

// Tools currently executing in a run. pi-mono events carry a stable
// `toolCallId`, but updates/ends may omit args, so remember start metadata by id
// and keep `activeTool` as the last-active fallback for old/partial events.
export const activeToolSchema = z
	.object({
		kind: activityKindSchema,
		isCheck: z.boolean(),
		target: z.string().optional(),
		toolCallId: z.string().optional(),
	})
	.strict();
export type ActiveTool = z.infer<typeof activeToolSchema>;

export const attemptStreamsSchema = z
	.object({
		tool: z.string().optional(),
		thinking: z.string().optional(),
		message: z.string().optional(),
	})
	.strict();
export type AttemptStreams = z.infer<typeof attemptStreamsSchema>;

export const timelineEntrySchema = z
	.object({
		atMs: nonNegativeIntegerSchema,
		text: z.string(),
		kind: activityKindSchema,
	})
	.strict();
export type TimelineEntry = z.infer<typeof timelineEntrySchema>;

export const activityToneSchema = z.enum(["ok", "bad", "info"]);
export type ActivityTone = z.infer<typeof activityToneSchema>;

export const activityEntrySchema = z
	.object({
		atMs: nonNegativeIntegerSchema,
		tone: activityToneSchema,
		text: z.string(),
	})
	.strict();
export type ActivityEntry = z.infer<typeof activityEntrySchema>;

export const loopPulseSchema = z
	.object({
		tickId: nonNegativeIntegerSchema,
		atMs: nonNegativeIntegerSchema,
		found: nonNegativeIntegerSchema,
		started: nonNegativeIntegerSchema,
	})
	.strict();
export type LoopPulse = z.infer<typeof loopPulseSchema>;

export const usageTotalsSchema = z
	.object({
		tokens: nonNegativeIntegerSchema,
		cost: z.number().nonnegative().optional(),
	})
	.strict();
export type UsageTotals = z.infer<typeof usageTotalsSchema>;

export const tokenSampleSchema = z
	.object({
		atMs: nonNegativeIntegerSchema,
		tokens: nonNegativeIntegerSchema,
	})
	.strict();
export type TokenSample = z.infer<typeof tokenSampleSchema>;

export const runtimeIdentityProjectionSchema = z
	.object({
		cwdName: z.string(),
		cwd: z.string(),
		workflowPath: z.string().optional(),
		provider: z.string().optional(),
		model: z.string().optional(),
		thinking: z.string().optional(),
		skills: z.array(z.string()).readonly(),
		skillPaths: z.array(z.string()).readonly(),
		tickIntervalMs: nonNegativeIntegerSchema.optional(),
		maxConcurrentRuns: nonNegativeIntegerSchema.optional(),
		maxRunDurationMs: nonNegativeIntegerSchema.optional(),
	})
	.strict();
export type RuntimeIdentityProjection = z.infer<
	typeof runtimeIdentityProjectionSchema
>;

export const workCheckSchema = z.enum([
	"not-run",
	"running",
	"passed",
	"failed",
]);
export type WorkCheck = z.infer<typeof workCheckSchema>;

export const tokenUsageProjectionSchema = z
	.object({
		input: nonNegativeIntegerSchema.optional(),
		output: nonNegativeIntegerSchema.optional(),
		total: nonNegativeIntegerSchema.optional(),
		cost: z.number().nonnegative().optional(),
	})
	.strict();
export type TokenUsageProjection = z.infer<typeof tokenUsageProjectionSchema>;

export const agentTranscriptReferenceSchema = z
	.object({
		id: z.string().optional(),
		path: z.string().optional(),
	})
	.strict();
export type AgentTranscriptReference = z.infer<
	typeof agentTranscriptReferenceSchema
>;

export const workItemProjectionSchema = z
	.object({
		workKey: z.string(),
		sourceId: z.string(),
		subject: z.string().optional(),
		primary: z.string().optional(),
		title: z.string(),
		subtitle: z.string().optional(),
		url: z.string().optional(),
		version: z.string().optional(),
		labels: z.array(z.string()).readonly(),
		status: workStatusSchema,
		blockedReason: z.string().optional(),
		operatorActions: z.array(operatorActionSchema).readonly().optional(),
		currentRunId: z.string().optional(),
	})
	.strict();
export type WorkItemProjection = z.infer<typeof workItemProjectionSchema>;

export const agentAttemptProjectionSchema = z
	.object({
		runId: z.string(),
		workKey: z.string(),
		sourceId: z.string(),
		subject: z.string().optional(),
		stage: attemptStageSchema,
		startedAtSeq: nonNegativeIntegerSchema,
		lastEventSeq: nonNegativeIntegerSchema,
		startedAtMs: nonNegativeIntegerSchema.optional(),
		lastEventAtMs: nonNegativeIntegerSchema.optional(),
		turnCount: nonNegativeIntegerSchema,
		eventCount: nonNegativeIntegerSchema,
		meaningfulCount: nonNegativeIntegerSchema,
		toolUpdateCount: nonNegativeIntegerSchema,
		messageCount: nonNegativeIntegerSchema,
		// The single live "now" line — already churn-resolved at reduce time, so
		// consumers render it directly (no re-derivation in the view model).
		activity: z.string(),
		activityKind: activityKindSchema,
		streaming: z.boolean(),
		lastMeaningful: z.string(),
		check: workCheckSchema,
		commands: z.array(z.string()).readonly(),
		observations: z.array(z.string()).readonly(),
		streams: attemptStreamsSchema,
		phases: z.array(phaseEntrySchema).readonly(),
		timeline: z.array(timelineEntrySchema).readonly(),
		activeTool: activeToolSchema.optional(),
		activeTools: z.map(z.string(), activeToolSchema).readonly().optional(),
		tokens: tokenUsageProjectionSchema.optional(),
		transcript: agentTranscriptReferenceSchema.optional(),
	})
	.strict();
export type AgentAttemptProjection = z.infer<
	typeof agentAttemptProjectionSchema
>;

export const completedWorkProjectionSchema = z
	.object({
		workKey: z.string(),
		runId: z.string().optional(),
		label: z.string(),
		status: z.string(),
		message: z.string(),
		atMs: nonNegativeIntegerSchema,
		durationMs: nonNegativeIntegerSchema.optional(),
		url: z.string().optional(),
		labels: z.array(z.string()).readonly().optional(),
		tokens: tokenUsageProjectionSchema.optional(),
	})
	.strict();
export type CompletedWorkProjection = z.infer<
	typeof completedWorkProjectionSchema
>;

export const scheduledWakeProjectionSchema = z
	.object({
		dueAtMs: nonNegativeIntegerSchema,
		delayMs: nonNegativeIntegerSchema,
		reason: z.string().optional(),
		workKey: z.string().optional(),
		attempt: nonNegativeIntegerSchema.optional(),
	})
	.strict();
export type ScheduledWakeProjection = z.infer<
	typeof scheduledWakeProjectionSchema
>;

export const dashboardProjectionSchema = z
	.object({
		sessionId: z.string(),
		workflowName: z.string(),
		runtime: runtimeIdentityProjectionSchema,
		status: dashboardStatusSchema,
		frontier: nonNegativeIntegerSchema,
		pulse: loopPulseSchema.optional(),
		usageTotals: usageTotalsSchema,
		tokenSamples: z.array(tokenSampleSchema).readonly(),
		work: z.map(z.string(), workItemProjectionSchema).readonly(),
		attempts: z.map(z.string(), agentAttemptProjectionSchema).readonly(),
		completed: z.array(completedWorkProjectionSchema).readonly(),
		diagnostics: z.array(z.string()).readonly(),
		scheduledWakes: z.array(scheduledWakeProjectionSchema).readonly(),
		activity: z.array(activityEntrySchema).readonly(),
		debugEvents: z.array(z.string()).readonly(),
	})
	.strict();
export type DashboardProjection = z.infer<typeof dashboardProjectionSchema>;

export const safeParseDashboardProjection = (value: unknown) =>
	dashboardProjectionSchema.safeParse(value);

export const emptyProjection = (
	sessionId: string,
	workflowName: string,
	runtime: RuntimeIdentityProjection = {
		cwd: "",
		cwdName: "",
		skills: [],
		skillPaths: [],
	},
): DashboardProjection => ({
	sessionId,
	workflowName,
	runtime,
	status: "starting",
	frontier: 0,
	usageTotals: { tokens: 0 },
	tokenSamples: [],
	work: new Map(),
	attempts: new Map(),
	completed: [],
	diagnostics: [],
	scheduledWakes: [],
	activity: [],
	debugEvents: [],
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown): string | undefined =>
	typeof value === "string" ? value : undefined;

const eventSummary = (
	record: Extract<PlotServerRecord, { kind: "session_event" }>,
) => {
	if (record.event.type === "agent_run_event" && isRecord(record.event.payload))
		return text(record.event.payload["eventType"]) ?? "agent_run_event";
	return record.event.type;
};

const displayFrom = (value: unknown) => (isRecord(value) ? value : undefined);
const displayString = (
	display: Record<string, unknown> | undefined,
	key: string,
) => (display === undefined ? undefined : text(display[key]));
const displayLabels = (display: Record<string, unknown> | undefined) => {
	const labels = display?.["labels"];
	return Array.isArray(labels)
		? labels.filter((label): label is string => typeof label === "string")
		: [];
};

const mapValues = (value: unknown): readonly unknown[] => {
	if (value instanceof Map) return [...value.values()];
	if (Array.isArray(value))
		return value.map((entry) =>
			Array.isArray(entry) && entry.length >= 2 ? entry[1] : entry,
		);
	if (isRecord(value)) return Object.values(value);
	return [];
};

const inlineText = (value: string, max = 140) =>
	value.replace(/\s+/g, " ").trim().slice(0, max);
const inlineMessageText = (value: string, max = 120) =>
	inlineText(value.replace(/\*\*([^*]+)\*\*/g, "$1"), max);
const ansiEscape = String.fromCharCode(27);
const stripAnsiCodes = (value: string) =>
	value.replace(new RegExp(`${ansiEscape}\\[[0-9;]*m`, "g"), "");

const baseName = (path: string) => {
	const trimmed = path.replace(/\/+$/, "");
	const tail = trimmed.slice(trimmed.lastIndexOf("/") + 1);
	return tail.length === 0 ? trimmed : tail;
};

// ── pi-mono event classification ──────────────────────────────────────────
// The inner `event` is a verbatim pi-mono AgentSessionEvent. Its shape is
// typed and stable, so classification reads first-class fields (`toolName`,
// `args`, `isError`) instead of guessing from prose.

const TOOL_KIND: Record<string, ActivityKind> = {
	read: "read",
	edit: "edit",
	write: "edit",
	grep: "search",
	find: "search",
	ls: "search",
	bash: "run",
};

const isCheckCommand = (command: string) =>
	/\b(bun run (check|test)|vitest|jest|tsc|typecheck|lint|pytest|go test|cargo (test|check))\b/i.test(
		command,
	);

const isFinishCommand = (command: string) =>
	/\b(gh pr (review|comment|merge)|git push|publish|gh release)\b/i.test(
		command,
	);

const argTarget = (toolName: string, args: unknown): string | undefined => {
	if (!isRecord(args)) return undefined;
	if (toolName === "grep" || toolName === "find") return text(args["pattern"]);
	if (toolName === "bash") return text(args["command"]);
	return text(args["path"]);
};

const kindForTool = (
	toolName: string,
	target: string | undefined,
): ActivityKind => {
	const isBash = toolName === "bash";
	if (isBash && target !== undefined && isCheckCommand(target)) return "test";
	if (isBash && target !== undefined && isFinishCommand(target))
		return "finish";
	return TOOL_KIND[toolName] ?? "run";
};

const pendingToolLabel = (
	toolName: string,
	target: string | undefined,
	kind: ActivityKind,
) => {
	switch (kind) {
		case "read":
			return `Preparing read ${baseName(target ?? "file")}`;
		case "edit":
			return `Preparing edit ${baseName(target ?? "file")}`;
		case "search":
			return inlineText(`Preparing search ${target ?? ""}`, 56).trim();
		case "test":
		case "finish":
		case "run":
			return inlineText(`Preparing ${target ?? toolName}`, 72);
		default:
			return inlineText(`Preparing ${toolName}`, 56);
	}
};

interface MessageParts {
	readonly mode: "delta" | "partial";
	readonly thinking?: string;
	readonly message?: string;
	readonly tool?: string;
	readonly toolKind?: ActivityKind;
	readonly toolCallId?: string;
}

const joined = (parts: readonly string[]) => {
	const combined = parts.join("");
	return combined.trim().length === 0 ? undefined : inlineMessageText(combined);
};

const messageContentParts = (
	message: unknown,
): Omit<MessageParts, "mode"> | undefined => {
	if (!isRecord(message)) return undefined;
	const content = message["content"];
	if (typeof content === "string") {
		const messageText = inlineMessageText(content);
		return messageText.length === 0 ? undefined : { message: messageText };
	}
	if (!Array.isArray(content)) return undefined;
	const thinking = joined(
		content.flatMap((item) => {
			if (!isRecord(item)) return [];
			if (item["type"] === "thinking" || item["type"] === "reasoning")
				return text(item["thinking"]) ?? text(item["reasoning"]) ?? [];
			return [];
		}),
	);
	const messageText = joined(
		content.flatMap((item) => {
			if (!isRecord(item)) return [];
			if (item["type"] === "text") return text(item["text"]) ?? [];
			return [];
		}),
	);
	const toolCalls = content.flatMap((item) => {
		if (!isRecord(item) || item["type"] !== "toolCall") return [];
		const toolName = text(item["name"]);
		if (toolName === undefined) return [];
		const target = argTarget(toolName, item["arguments"]);
		const toolKind = kindForTool(toolName, target);
		const toolCallId = text(item["id"]);
		return [
			{
				tool: pendingToolLabel(toolName, target, toolKind),
				toolKind,
				...(toolCallId === undefined ? {} : { toolCallId }),
			},
		];
	});
	const toolCall = toolCalls[toolCalls.length - 1];
	if (
		thinking === undefined &&
		messageText === undefined &&
		toolCall === undefined
	)
		return undefined;
	return {
		...(thinking === undefined ? {} : { thinking }),
		...(messageText === undefined ? {} : { message: messageText }),
		...(toolCall === undefined ? {} : toolCall),
	};
};

const messageParts = (
	event: Record<string, unknown>,
): MessageParts | undefined => {
	const ame = event["assistantMessageEvent"];
	if (isRecord(ame)) {
		const partial = messageContentParts(ame["partial"]);
		if (partial !== undefined) return { mode: "partial", ...partial };
		const delta = text(ame["delta"]);
		const eventType = text(ame["type"]);
		if (delta !== undefined && delta.trim().length > 0) {
			if (eventType === "thinking_delta")
				return { mode: "delta", thinking: inlineMessageText(delta) };
			if (eventType === "text_delta")
				return { mode: "delta", message: inlineMessageText(delta) };
		}
	}
	const message = messageContentParts(event["message"]);
	return message === undefined ? undefined : { mode: "partial", ...message };
};

const toolResultLine = (value: unknown): string | undefined => {
	if (!isRecord(value)) return undefined;
	const content = value["content"];
	if (!Array.isArray(content)) return undefined;
	const lines = content
		.flatMap((item) => {
			if (!isRecord(item) || item["type"] !== "text") return [];
			return text(item["text"]) ?? [];
		})
		.join("\n")
		.replace(/\r/g, "\n")
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	const line = lines[lines.length - 1];
	return line === undefined ? undefined : inlineText(stripAnsiCodes(line), 90);
};

type EventPhase = "turn" | "start" | "update" | "end" | "message" | "none";

interface Classified {
	readonly type: string;
	readonly phase: EventPhase;
	readonly kind: ActivityKind;
	readonly target?: string;
	readonly toolCallId?: string;
	readonly isCheck: boolean;
	readonly isError: boolean;
	readonly message?: MessageParts;
}

const classify = (raw: unknown): Classified => {
	const base = {
		type: "",
		phase: "none" as EventPhase,
		kind: "message" as ActivityKind,
		isCheck: false,
		isError: false,
	};
	if (!isRecord(raw)) return base;
	const type = text(raw["type"]) ?? "";
	if (type === "turn_start")
		return { ...base, type, phase: "turn", kind: "think" };
	if (
		type === "tool_execution_start" ||
		type === "tool_execution_update" ||
		type === "tool_execution_end"
	) {
		const toolName = text(raw["toolName"]) ?? "";
		const target = argTarget(toolName, raw["args"]);
		const isCheck =
			toolName === "bash" && target !== undefined && isCheckCommand(target);
		const kind = kindForTool(toolName, target);
		const toolCallId = text(raw["toolCallId"]);
		const phase: EventPhase =
			type === "tool_execution_start"
				? "start"
				: type === "tool_execution_update"
					? "update"
					: "end";
		return {
			type,
			phase,
			kind,
			...(target === undefined ? {} : { target }),
			...(toolCallId === undefined ? {} : { toolCallId }),
			isCheck,
			isError: phase === "end" && raw["isError"] === true,
		};
	}
	if (
		type === "message_start" ||
		type === "message_update" ||
		type === "message_end"
	) {
		const message = messageParts(raw);
		return {
			...base,
			type,
			phase: "message",
			kind: message?.toolKind ?? base.kind,
			...(message ? { message } : {}),
		};
	}
	return { ...base, type };
};

const liveLabel = (kind: ActivityKind, target: string | undefined): string => {
	switch (kind) {
		case "read":
			return `Reading ${baseName(target ?? "file")}`;
		case "edit":
			return `Editing ${baseName(target ?? "file")}`;
		case "search":
			return inlineText(`Searching ${target ?? ""}`, 56).trim();
		case "test":
			return inlineText(`Running ${target ?? "check"}`, 64);
		case "finish":
			return inlineText(`Posting ${target ?? "result"}`, 56);
		case "think":
			return "Thinking";
		default:
			return inlineText(`Running ${target ?? "command"}`, 64);
	}
};

const doneLabel = (
	kind: ActivityKind,
	target: string | undefined,
	isError: boolean,
): string => {
	if (isError) return inlineText(`Failed ${target ?? ""}`, 64).trim();
	switch (kind) {
		case "read":
			return `Read ${baseName(target ?? "file")}`;
		case "edit":
			return `Edited ${baseName(target ?? "file")}`;
		case "search":
			return inlineText(`Searched ${target ?? ""}`, 56).trim();
		case "test":
			return inlineText(`Ran ${target ?? "check"}`, 64);
		case "finish":
			return inlineText(`Posted ${target ?? "result"}`, 56);
		default:
			return inlineText(`Ran ${target ?? "command"}`, 64);
	}
};

// ── usage extraction (pi-mono attaches Usage to message_end) ───────────────
interface UsageDelta {
	readonly input?: number;
	readonly output?: number;
	readonly total: number;
	readonly cost?: number;
}

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

const extractUsage = (event: unknown): UsageDelta | undefined => {
	if (!isRecord(event)) return undefined;
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
	return {
		...(input === undefined ? {} : { input }),
		...(output === undefined ? {} : { output }),
		total,
		...(cost === undefined ? {} : { cost }),
	};
};

const addUsage = (
	previous: AgentAttemptProjection["tokens"],
	delta: UsageDelta,
): NonNullable<AgentAttemptProjection["tokens"]> => ({
	input: (previous?.input ?? 0) + (delta.input ?? 0),
	output: (previous?.output ?? 0) + (delta.output ?? 0),
	total: (previous?.total ?? 0) + delta.total,
	cost: (previous?.cost ?? 0) + (delta.cost ?? 0),
});

const sampleWindowMs = 90 * 1000;

const appendSample = (
	samples: readonly TokenSample[],
	sample: TokenSample,
): readonly TokenSample[] =>
	[...samples, sample].filter(
		(entry) => sample.atMs - entry.atMs <= sampleWindowMs,
	);

const appendBounded = (items: readonly string[], item: string, max: number) =>
	[item, ...items.filter((existing) => existing !== item)].slice(0, max);

const prependTimeline = (
	items: readonly TimelineEntry[],
	entry: TimelineEntry,
	max: number,
) => [entry, ...items].slice(0, max);

const prependActivity = (
	items: readonly ActivityEntry[],
	entry: ActivityEntry,
	max = 50,
) => [entry, ...items].slice(0, max);

const streamText = (
	previous: string | undefined,
	value: string | undefined,
	mode: MessageParts["mode"],
) => {
	if (value === undefined) return previous;
	return mode === "partial"
		? inlineMessageText(value)
		: inlineMessageText(`${previous ?? ""}${value}`);
};

const withoutToolStream = (streams: AttemptStreams): AttemptStreams => {
	const { tool: _tool, ...rest } = streams;
	return rest;
};

const thinkingLine = (thinking: string | undefined) =>
	thinking === undefined ? undefined : `Thinking · ${thinking}`;

const activityFromStreams = (streams: AttemptStreams) =>
	streams.tool ?? streams.message ?? thinkingLine(streams.thinking);

const PHASE_MAX = 24;

// Coalesce consecutive same-kind activity into one phase, accumulating a count
// that survives the bounded timeline tail. Timed off the event's observedAtMs
// (event timestamp on replay), so phases rebuild identically from history.
const accumulatePhase = (
	phases: readonly PhaseEntry[],
	kind: ActivityKind,
	atMs: number,
	target: string | undefined,
): readonly PhaseEntry[] => {
	const last = phases[phases.length - 1];
	if (last !== undefined && last.kind === kind)
		return [
			...phases.slice(0, -1),
			{ ...last, count: last.count + 1, ...(target ? { target } : {}) },
		];
	return [
		...phases,
		{ kind, count: 1, startedAtMs: atMs, ...(target ? { target } : {}) },
	].slice(-PHASE_MAX);
};

const deriveStage = (
	previous: AttemptStage,
	kind: ActivityKind,
	phase: EventPhase,
	isError: boolean,
): AttemptStage => {
	if (isError) return "failed";
	if (kind === "finish") return "finishing";
	if (kind === "test") return "verifying";
	if (phase === "none" || phase === "message")
		return previous === "starting" ? "working" : previous;
	return "working";
};

export const workLabel = (work: {
	readonly primary?: string | undefined;
	readonly title: string;
}) =>
	work.primary === undefined ? work.title : `${work.primary} ${work.title}`;

const workItemFromRecord = (
	record: Record<string, unknown>,
	previous: WorkItemProjection | undefined,
): WorkItemProjection => {
	const display = displayFrom(record["display"]);
	const primary = displayString(display, "primary") ?? previous?.primary;
	const title =
		displayString(display, "title") ??
		text(record["title"]) ??
		previous?.title ??
		text(record["subject"]) ??
		text(record["workKey"]) ??
		"work";
	const subtitle = displayString(display, "subtitle") ?? previous?.subtitle;
	const url = displayString(display, "url") ?? previous?.url;
	const version = displayString(display, "version") ?? previous?.version;
	const labels = displayLabels(display);
	const hasLabels = Array.isArray(display?.["labels"]);
	const parsedActions = z
		.array(operatorActionSchema)
		.safeParse(record["operatorActions"]);
	const status = workStatusSchema.safeParse(record["status"]);
	const currentRunId = text(record["currentRunId"]);
	const subject = text(record["subject"]) ?? previous?.subject;
	const blockedReason = text(record["blockedReason"]);
	const operatorActions = parsedActions.success
		? parsedActions.data
		: previous?.operatorActions;
	return {
		workKey: text(record["workKey"]) ?? previous?.workKey ?? "work",
		sourceId: text(record["sourceId"]) ?? previous?.sourceId ?? "source",
		...(subject === undefined ? {} : { subject }),
		...(primary === undefined ? {} : { primary }),
		title,
		...(subtitle === undefined ? {} : { subtitle }),
		...(url === undefined ? {} : { url }),
		...(version === undefined ? {} : { version }),
		labels: hasLabels ? labels : (previous?.labels ?? []),
		status: status.success ? status.data : (previous?.status ?? "pending"),
		...(blockedReason === undefined ? {} : { blockedReason }),
		...(operatorActions === undefined ? {} : { operatorActions }),
		...(currentRunId === undefined ? {} : { currentRunId }),
	};
};

const workItemFromRun = (
	run: Record<string, unknown>,
	previous: WorkItemProjection | undefined,
	status: WorkStatus,
	currentRunId?: string,
): WorkItemProjection =>
	workItemFromRecord(
		{
			...run,
			status,
			...(currentRunId === undefined ? {} : { currentRunId }),
		},
		previous,
	);

const baseAgentAttempt = (
	workKey: string,
	runId: string,
	sourceId: string,
	stage: AttemptStage,
	seq: number,
	atMs: number | undefined,
): AgentAttemptProjection => ({
	workKey,
	runId,
	sourceId,
	stage,
	startedAtSeq: seq,
	lastEventSeq: seq,
	...(atMs === undefined ? {} : { startedAtMs: atMs, lastEventAtMs: atMs }),
	turnCount: 0,
	eventCount: 0,
	meaningfulCount: 0,
	toolUpdateCount: 0,
	messageCount: 0,
	activity: "Waiting to start",
	activityKind: "wait",
	streaming: false,
	lastMeaningful: "started",
	check: "not-run",
	commands: [],
	observations: [],
	streams: {},
	phases: [],
	timeline: [],
});

export const applySnapshot = (
	projection: DashboardProjection,
	data: unknown,
): DashboardProjection => {
	const snapshot =
		isRecord(data) && isRecord(data["snapshot"]) ? data["snapshot"] : undefined;
	if (!snapshot) return projection;
	const asOfRaw = isRecord(data) ? data["asOfSequence"] : undefined;
	const asOfSequence = typeof asOfRaw === "number" ? asOfRaw : undefined;
	if (asOfSequence !== undefined && asOfSequence < projection.frontier)
		return projection;
	const workValues = mapValues(snapshot["work"]);
	const work = new Map(projection.work);
	for (const item of workValues) {
		if (!isRecord(item)) continue;
		const key = text(item["workKey"]);
		if (key === undefined) continue;
		work.set(key, workItemFromRecord(item, work.get(key)));
	}
	for (const key of work.keys()) {
		if (
			!workValues.some(
				(item) => isRecord(item) && text(item["workKey"]) === key,
			)
		)
			work.delete(key);
	}

	const runningValues = mapValues(snapshot["running"]);
	const attempts = new Map(projection.attempts);
	for (const run of runningValues) {
		if (!isRecord(run)) continue;
		const workKey = text(run["workKey"]) ?? "work";
		const runId = text(run["runId"]) ?? "run";
		const previous = attempts.get(runId);
		const attempt = {
			...baseAgentAttempt(
				workKey,
				runId,
				text(run["sourceId"]) ?? previous?.sourceId ?? "source",
				previous?.stage ?? "starting",
				previous?.startedAtSeq ?? projection.frontier,
				previous?.startedAtMs,
			),
			...previous,
			...(text(run["subject"]) === undefined
				? {}
				: { subject: text(run["subject"]) }),
		};
		attempts.set(runId, attempt);
		if (!work.has(workKey))
			work.set(workKey, workItemFromRun(run, undefined, "running", runId));
	}
	for (const key of attempts.keys()) {
		if (
			!runningValues.some((run) => isRecord(run) && text(run["runId"]) === key)
		)
			attempts.delete(key);
	}
	const scheduledWakes = Array.isArray(snapshot["scheduledWakes"])
		? snapshot["scheduledWakes"].filter(isRecord).flatMap((wake) => {
				const dueAtMs = wake["dueAtMs"];
				const delayMs = wake["delayMs"];
				const reason = text(wake["reason"]);
				const workKey = text(wake["workKey"]);
				const attempt = wake["attempt"];
				if (typeof dueAtMs !== "number" || typeof delayMs !== "number")
					return [];
				return [
					{
						dueAtMs,
						delayMs,
						...(reason === undefined ? {} : { reason }),
						...(workKey === undefined ? {} : { workKey }),
						...(typeof attempt === "number" ? { attempt } : {}),
					},
				];
			})
		: projection.scheduledWakes;
	const diagnostics = Array.isArray(snapshot["diagnostics"])
		? snapshot["diagnostics"].slice(-5).map(diagnosticText)
		: projection.diagnostics;
	const frontier =
		asOfSequence === undefined
			? projection.frontier
			: Math.max(projection.frontier, asOfSequence);
	const status =
		projection.status === "paused" ||
		projection.status === "shutting_down" ||
		projection.status === "stopped" ||
		runningValues.length === 0
			? projection.status
			: "running";
	return {
		...projection,
		status,
		frontier,
		work,
		attempts,
		diagnostics,
		scheduledWakes,
	};
};

const diagnosticText = (diagnostic: unknown) =>
	isRecord(diagnostic)
		? `${text(diagnostic["level"]) ?? "diagnostic"}/${text(diagnostic["phase"]) ?? "unknown"}: ${text(diagnostic["message"]) ?? JSON.stringify(diagnostic)}`
		: String(diagnostic);

const reduceTickStarted = (
	projection: DashboardProjection,
	tickId: unknown,
	observedAtMs: number,
): DashboardProjection => ({
	...projection,
	status: "running",
	activity: prependActivity(projection.activity, {
		atMs: observedAtMs,
		tone: "info",
		text: `tick #${typeof tickId === "number" ? tickId : 0} started`,
	}),
});

const reduceTickCompleted = (
	projection: DashboardProjection,
	result: unknown,
	observedAtMs: number,
): DashboardProjection => {
	if (!isRecord(result)) return projection;
	const tickId = typeof result["tickId"] === "number" ? result["tickId"] : 0;
	const found = Array.isArray(result["selected"])
		? result["selected"].length
		: typeof result["selectedCount"] === "number"
			? result["selectedCount"]
			: 0;
	const started = Array.isArray(result["started"])
		? result["started"].length
		: typeof result["startedCount"] === "number"
			? result["startedCount"]
			: 0;
	const pulse: LoopPulse = { tickId, atMs: observedAtMs, found, started };
	const activity =
		found > 0
			? prependActivity(projection.activity, {
					atMs: observedAtMs,
					tone: "info",
					text: `tick #${tickId} found ${found} work, started ${started}`,
				})
			: projection.activity;
	const diagnostics = Array.isArray(result["diagnostics"])
		? [
				...result["diagnostics"].map(diagnosticText),
				...projection.diagnostics,
			].slice(0, 5)
		: projection.diagnostics;
	const status =
		projection.status === "paused" ||
		projection.status === "shutting_down" ||
		projection.status === "stopped"
			? projection.status
			: projection.attempts.size > 0 || started > 0
				? "running"
				: "idle";
	return { ...projection, status, pulse, activity, diagnostics };
};

const reduceWorkObserved = (
	projection: DashboardProjection,
	record: Record<string, unknown>,
): DashboardProjection => {
	const item = workItemFromRecord(
		record,
		projection.work.get(text(record["workKey"]) ?? ""),
	);
	return {
		...projection,
		work: new Map(projection.work).set(item.workKey, item),
	};
};

const reduceWorkRemoved = (
	projection: DashboardProjection,
	workKey: unknown,
): DashboardProjection => {
	const key = text(workKey);
	if (key === undefined) return projection;
	const work = new Map(projection.work);
	work.delete(key);
	return {
		...projection,
		work,
		scheduledWakes: projection.scheduledWakes.filter(
			(wake) => wake.workKey !== key,
		),
	};
};

const reduceAttemptStarted = (
	projection: DashboardProjection,
	run: Record<string, unknown>,
	sequence: number,
	observedAtMs: number,
): DashboardProjection => {
	const workKey = text(run["workKey"]) ?? "work";
	const runId = text(run["runId"]) ?? "run";
	const attempts = new Map(projection.attempts);
	const work = new Map(projection.work);
	const previousWork = work.get(workKey);
	const item = workItemFromRun(run, previousWork, "running", runId);
	work.set(workKey, item);
	const attempt: AgentAttemptProjection = {
		...baseAgentAttempt(
			workKey,
			runId,
			text(run["sourceId"]) ?? "source",
			"starting",
			sequence,
			observedAtMs,
		),
		...(text(run["subject"]) === undefined
			? {}
			: { subject: text(run["subject"]) }),
		activity: "Starting work",
		lastMeaningful: item.labels.join(",") || "started",
		timeline: [{ atMs: observedAtMs, text: "attempt started", kind: "wait" }],
	};
	attempts.set(runId, attempt);
	return {
		...projection,
		work,
		attempts,
		activity: prependActivity(projection.activity, {
			atMs: observedAtMs,
			tone: "info",
			text: `${workLabel(item)} started`,
		}),
	};
};

const reduceAttemptCompleted = (
	projection: DashboardProjection,
	completion: Record<string, unknown>,
	observedAtMs: number,
): DashboardProjection => {
	const workKey = text(completion["workKey"]) ?? "work";
	const runId = text(completion["runId"]);
	const status = text(completion["status"]) ?? "completed";
	const error = text(completion["error"]);
	const attempts = new Map(projection.attempts);
	const work = new Map(projection.work);
	const priorAttempt =
		runId === undefined
			? [...attempts.values()].find((attempt) => attempt.workKey === workKey)
			: attempts.get(runId);
	if (priorAttempt !== undefined) attempts.delete(priorAttempt.runId);
	const priorWork = work.get(workKey);
	const label = priorWork === undefined ? workKey : workLabel(priorWork);
	const completedRunId = runId ?? priorAttempt?.runId;
	const durationMs =
		priorAttempt?.startedAtMs === undefined
			? undefined
			: Math.max(0, observedAtMs - priorAttempt.startedAtMs);
	const ok = status === "succeeded";
	if (ok) work.delete(workKey);
	else if (priorWork !== undefined)
		work.set(workKey, {
			workKey: priorWork.workKey,
			sourceId: priorWork.sourceId,
			...(priorWork.subject === undefined
				? {}
				: { subject: priorWork.subject }),
			...(priorWork.primary === undefined
				? {}
				: { primary: priorWork.primary }),
			title: priorWork.title,
			...(priorWork.subtitle === undefined
				? {}
				: { subtitle: priorWork.subtitle }),
			...(priorWork.url === undefined ? {} : { url: priorWork.url }),
			...(priorWork.version === undefined
				? {}
				: { version: priorWork.version }),
			labels: priorWork.labels,
			status: "failed",
			...(priorWork.blockedReason === undefined
				? {}
				: { blockedReason: priorWork.blockedReason }),
			...(priorWork.operatorActions === undefined
				? {}
				: { operatorActions: priorWork.operatorActions }),
		});
	return {
		...projection,
		work,
		attempts,
		scheduledWakes: projection.scheduledWakes.filter(
			(wake) => wake.workKey !== workKey,
		),
		activity: prependActivity(projection.activity, {
			atMs: observedAtMs,
			tone: ok ? "ok" : "bad",
			text: `${label} ${status}${error === undefined ? "" : ` · ${error}`}`,
		}),
		completed: [
			{
				workKey,
				...(completedRunId === undefined ? {} : { runId: completedRunId }),
				label,
				status,
				message: error ?? "completed",
				atMs: observedAtMs,
				...(durationMs === undefined ? {} : { durationMs }),
				...(priorWork?.url === undefined ? {} : { url: priorWork.url }),
				...(priorWork?.labels === undefined
					? {}
					: { labels: priorWork.labels }),
				...(priorAttempt?.tokens === undefined
					? {}
					: { tokens: priorAttempt.tokens }),
			},
			...projection.completed,
		].slice(0, 20),
	};
};

const reduceWakeScheduled = (
	projection: DashboardProjection,
	wake: Record<string, unknown>,
	observedAtMs: number,
): DashboardProjection => {
	const delayMs = wake["delayMs"];
	if (typeof delayMs !== "number") return projection;
	const dueAtMs =
		typeof wake["dueAtMs"] === "number"
			? wake["dueAtMs"]
			: observedAtMs + delayMs;
	const reason = text(wake["reason"]);
	const workKey = text(wake["workKey"]);
	const attempt = wake["attempt"];
	return {
		...projection,
		scheduledWakes: [
			...projection.scheduledWakes,
			{
				dueAtMs,
				delayMs,
				...(reason === undefined ? {} : { reason }),
				...(workKey === undefined ? {} : { workKey }),
				...(typeof attempt === "number" ? { attempt } : {}),
			},
		].toSorted((a, b) => a.dueAtMs - b.dueAtMs),
	};
};

const reduceAgentSessionEvent = (
	projection: DashboardProjection,
	event: Record<string, unknown>,
	sequence: number,
	observedAtMs: number,
): DashboardProjection => {
	const workKey = text(event["workKey"]);
	const runId = text(event["runId"]);
	if (workKey === undefined) return projection;
	const attempts = new Map(projection.attempts);
	const previous =
		runId === undefined
			? [...attempts.values()].find((attempt) => attempt.workKey === workKey)
			: attempts.get(runId);
	if (previous === undefined) return projection;

	const rawEvent = event["event"];
	const classified = classify(rawEvent);
	const subject = text(event["subject"]) ?? previous.subject;

	// usage accrues on message_end regardless of meaningfulness
	const usage = extractUsage(rawEvent);
	const tokens =
		usage === undefined ? previous.tokens : addUsage(previous.tokens, usage);
	const usageTotals =
		usage === undefined
			? projection.usageTotals
			: {
					tokens: projection.usageTotals.tokens + usage.total,
					cost: (projection.usageTotals.cost ?? 0) + (usage.cost ?? 0),
				};
	const tokenSamples =
		usage === undefined
			? projection.tokenSamples
			: appendSample(projection.tokenSamples, {
					atMs: observedAtMs,
					tokens: usageTotals.tokens,
				});

	// Tool updates/ends may omit args, so resolve their kind/target/check-ness
	// from the start event remembered by toolCallId.
	const activeTools = new Map(previous.activeTools ?? []);
	if (
		previous.activeTool?.toolCallId !== undefined &&
		!activeTools.has(previous.activeTool.toolCallId)
	)
		activeTools.set(previous.activeTool.toolCallId, previous.activeTool);
	const active =
		classified.toolCallId === undefined
			? previous.activeTool
			: (activeTools.get(classified.toolCallId) ?? previous.activeTool);
	const needsActiveAttribution =
		classified.phase === "update" || classified.phase === "end";
	const kind: ActivityKind = needsActiveAttribution
		? (active?.kind ?? classified.kind)
		: classified.kind;
	const target = needsActiveAttribution
		? (classified.target ?? active?.target)
		: classified.target;
	const isCheck = needsActiveAttribution
		? (active?.isCheck ?? classified.isCheck)
		: classified.isCheck;

	// turn_start counts a real turn; tool/message deltas never do.
	const turnCount =
		classified.phase === "turn" ? previous.turnCount + 1 : previous.turnCount;

	// Timeline = completed meaningful actions (tool end, past tense) + turns.
	// In-progress tools live in `activity`, not the timeline, so it stays a clean
	// record rather than a delta firehose.
	const timelineWorthy =
		classified.phase === "turn" || classified.phase === "end";
	const timelineText =
		classified.phase === "turn"
			? "Thinking"
			: doneLabel(kind, target, classified.isError);
	const timelineKind: ActivityKind =
		classified.phase === "turn" ? "think" : kind;
	const timeline = timelineWorthy
		? prependTimeline(
				previous.timeline,
				{ atMs: observedAtMs, text: timelineText, kind: timelineKind },
				12,
			)
		: previous.timeline;

	// Phases coalesce on the start of each action (so N reads → one phase ·N).
	const phaseWorthy =
		classified.phase === "turn" || classified.phase === "start";
	const phaseKind: ActivityKind = classified.phase === "turn" ? "think" : kind;
	const phases = phaseWorthy
		? accumulatePhase(
				previous.phases,
				phaseKind,
				observedAtMs,
				classified.phase === "turn" ? undefined : target,
			)
		: previous.phases;

	let streams = previous.streams;
	if (classified.message !== undefined) {
		const thinking = streamText(
			streams.thinking,
			classified.message.thinking,
			classified.message.mode,
		);
		const message = streamText(
			streams.message,
			classified.message.message,
			classified.message.mode,
		);
		const tool = streamText(
			streams.tool,
			classified.message.tool,
			classified.message.mode,
		);
		streams = {
			...streams,
			...(thinking === undefined ? {} : { thinking }),
			...(message === undefined ? {} : { message }),
			...(tool === undefined ? {} : { tool }),
		};
	}
	if (classified.phase === "start" || classified.phase === "update") {
		const output =
			classified.phase === "update" && isRecord(rawEvent)
				? toolResultLine(rawEvent["partialResult"])
				: undefined;
		const label = liveLabel(kind, target);
		streams = {
			...streams,
			tool: output === undefined ? label : `${label} · ${output}`,
		};
	} else if (classified.phase === "end") streams = withoutToolStream(streams);

	// The live "now" line — resolved here so views render it verbatim while
	// exposing split streams for richer callsites.
	const streaming =
		classified.phase === "turn" ||
		classified.phase === "start" ||
		classified.phase === "update" ||
		(classified.phase === "message" && classified.type !== "message_end");
	const streamActivity = activityFromStreams(streams);
	const activity =
		classified.phase === "end"
			? doneLabel(kind, target, classified.isError)
			: classified.phase === "turn"
				? "Thinking"
				: (streamActivity ?? previous.activity);
	const activityKind =
		classified.phase === "end"
			? kind
			: streams.tool !== undefined
				? kind
				: streams.message !== undefined
					? "message"
					: streams.thinking !== undefined || classified.phase === "turn"
						? "think"
						: classified.phase === "none"
							? previous.activityKind
							: kind;

	const lastMeaningful = timelineWorthy
		? timelineText
		: classified.phase === "start"
			? liveLabel(kind, target)
			: previous.lastMeaningful;

	const commands =
		classified.phase === "start" &&
		(kind === "run" || kind === "test" || kind === "finish") &&
		target !== undefined
			? appendBounded(previous.commands, target, 8)
			: previous.commands;

	const observations = previous.observations;

	const check = isCheck
		? classified.phase === "start" || classified.phase === "update"
			? "running"
			: classified.phase === "end"
				? classified.isError
					? "failed"
					: "passed"
				: previous.check
		: previous.check;

	const next: AgentAttemptProjection = {
		...previous,
		runId: runId ?? previous.runId,
		sourceId: text(event["sourceId"]) ?? previous.sourceId,
		...(subject === undefined ? {} : { subject }),
		stage: deriveStage(
			previous.stage,
			kind,
			classified.phase,
			classified.isError,
		),
		lastEventSeq: sequence,
		lastEventAtMs: observedAtMs,
		turnCount,
		eventCount: previous.eventCount + 1,
		meaningfulCount:
			previous.meaningfulCount + (timelineWorthy || phaseWorthy ? 1 : 0),
		toolUpdateCount:
			previous.toolUpdateCount + (classified.phase === "update" ? 1 : 0),
		messageCount:
			previous.messageCount + (classified.phase === "message" ? 1 : 0),
		activity,
		activityKind,
		streaming,
		lastMeaningful,
		check,
		commands,
		observations,
		streams,
		phases,
		timeline,
		...(tokens === undefined ? {} : { tokens }),
	};
	// Track / clear in-flight tools by id for update/end attribution.
	if (classified.phase === "start") {
		const nextActiveTool = {
			kind,
			isCheck,
			...(target === undefined ? {} : { target }),
			...(classified.toolCallId === undefined
				? {}
				: { toolCallId: classified.toolCallId }),
		};
		next.activeTool = nextActiveTool;
		if (classified.toolCallId !== undefined) {
			const nextActiveTools = new Map(activeTools);
			nextActiveTools.set(classified.toolCallId, nextActiveTool);
			next.activeTools = nextActiveTools;
		}
	} else if (classified.phase === "end") {
		const nextActiveTools = new Map(activeTools);
		if (classified.toolCallId !== undefined)
			nextActiveTools.delete(classified.toolCallId);
		else if (active?.toolCallId !== undefined)
			nextActiveTools.delete(active.toolCallId);
		if (nextActiveTools.size === 0) {
			delete next.activeTool;
			delete next.activeTools;
		} else {
			next.activeTools = nextActiveTools;
			next.activeTool = [...nextActiveTools.values()][nextActiveTools.size - 1];
		}
	}
	attempts.delete(previous.runId);
	attempts.set(next.runId, next);
	return { ...projection, usageTotals, tokenSamples, attempts };
};

const pruneScheduledWakes = (
	projection: DashboardProjection,
	observedAtMs: number,
): DashboardProjection => {
	const scheduledWakes = projection.scheduledWakes.filter(
		(wake) => wake.dueAtMs > observedAtMs,
	);
	return scheduledWakes.length === projection.scheduledWakes.length
		? projection
		: { ...projection, scheduledWakes };
};

const reduceEventPayload = (
	projection: DashboardProjection,
	type: string,
	payload: unknown,
	sequence: number,
	observedAtMs: number,
): DashboardProjection => {
	const current = pruneScheduledWakes(projection, observedAtMs);
	if (type === "session_started") return { ...current, status: "running" };
	if (type === "session_paused") return { ...current, status: "paused" };
	if (type === "session_resumed") return { ...current, status: "idle" };
	if (type === "session_close_requested")
		return { ...current, status: "shutting_down" };
	if (type === "session_shutdown" || type === "session_close_completed")
		return { ...current, status: "stopped", scheduledWakes: [] };
	if (type === "tick_started")
		return reduceTickStarted(
			current,
			isRecord(payload) ? payload["tickId"] : undefined,
			observedAtMs,
		);
	if (type === "tick_completed")
		return reduceTickCompleted(
			current,
			isRecord(payload) && payload["result"] !== undefined
				? payload["result"]
				: payload,
			observedAtMs,
		);
	if (type === "work_observed" && isRecord(payload)) {
		const work = isRecord(payload["work"]) ? payload["work"] : payload;
		return reduceWorkObserved(current, work);
	}
	if (type === "work_removed" && isRecord(payload))
		return reduceWorkRemoved(current, payload["workKey"]);
	if (type === "attempt_started" && isRecord(payload)) {
		const run = isRecord(payload["run"]) ? payload["run"] : payload;
		return reduceAttemptStarted(current, run, sequence, observedAtMs);
	}
	if (type === "attempt_completed" && isRecord(payload)) {
		const completion = isRecord(payload["completion"])
			? payload["completion"]
			: payload;
		return reduceAttemptCompleted(current, completion, observedAtMs);
	}
	if (
		(type === "agent_session_event" || type === "agent_run_event") &&
		isRecord(payload)
	)
		return reduceAgentSessionEvent(current, payload, sequence, observedAtMs);
	if (type === "wake_scheduled" && isRecord(payload))
		return reduceWakeScheduled(current, payload, observedAtMs);
	if (
		(type === "diagnostic_recorded" || type === "diagnostic") &&
		isRecord(payload)
	)
		return {
			...current,
			diagnostics: [diagnosticText(payload), ...current.diagnostics].slice(
				0,
				5,
			),
		};
	if (type === "operator_observation_recorded" && isRecord(payload))
		return {
			...current,
			activity: prependActivity(current.activity, {
				atMs: observedAtMs,
				tone: "info",
				text: `operator action ${text(payload["actionLabel"]) ?? text(payload["actionId"]) ?? "recorded"}`,
			}),
		};
	return current;
};

export const reduceRecord = (
	projection: DashboardProjection,
	record: PlotServerRecord,
): DashboardProjection => {
	if (record.kind !== "session_event") return projection;
	const sequence = Number(record.sequence);
	const observedAtMs = timestampMs(record.event.timestamp);
	const summary = eventSummary(record);
	const next: DashboardProjection = {
		...projection,
		frontier: sequence,
		debugEvents: [
			`#${record.sequence} ${summary}`,
			...projection.debugEvents,
		].slice(0, 100),
	};
	const event = record.event;
	return reduceEventPayload(
		next,
		event.type,
		event.payload,
		sequence,
		observedAtMs,
	);
};

const timestampMs = (timestamp: string) => {
	const ms = Date.parse(timestamp);
	return Number.isFinite(ms) ? ms : Date.now();
};

export const reduceSessionHistoryEvent = (
	projection: DashboardProjection,
	event: SessionHistoryEvent,
): DashboardProjection => {
	const sequence = Number(event.sequence);
	const next: DashboardProjection = {
		...projection,
		frontier: sequence,
		debugEvents: [
			`#${event.sequence} ${event.type}`,
			...projection.debugEvents,
		].slice(0, 100),
	};
	return reduceEventPayload(
		next,
		event.type,
		event.payload,
		sequence,
		timestampMs(event.timestamp),
	);
};

export const rebuildProjectionFromSessionHistory = (
	events: readonly SessionHistoryEvent[],
	projection: DashboardProjection,
): DashboardProjection =>
	events.reduce(
		(current, event) => reduceSessionHistoryEvent(current, event),
		projection,
	);
