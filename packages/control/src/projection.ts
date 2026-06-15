import { z } from "zod";
import { operatorActionSchema } from "./operator.js";
import type { PlotServerRecord } from "./protocol.js";
import { nonNegativeIntegerSchema } from "./session-summary.js";

export const dashboardStatusSchema = z.enum([
	"starting",
	"idle",
	"running",
	"shutting_down",
	"stopped",
	"error",
]);
export type DashboardStatus = z.infer<typeof dashboardStatusSchema>;
export type TuiStatus = DashboardStatus;

export const workStageSchema = z.enum([
	"starting",
	"waiting",
	"working",
	"verifying",
	"finishing",
	"blocked",
	"failed",
]);
export type WorkStage = z.infer<typeof workStageSchema>;

export const timelineEntrySchema = z
	.object({
		atMs: nonNegativeIntegerSchema,
		text: z.string(),
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

export const runningWorkProjectionSchema = z
	.object({
		workKey: z.string(),
		runId: z.string(),
		sourceId: z.string(),
		subject: z.string().optional(),
		primary: z.string().optional(),
		title: z.string(),
		subtitle: z.string().optional(),
		url: z.string().optional(),
		stage: workStageSchema,
		startedAtSeq: nonNegativeIntegerSchema,
		lastEventSeq: nonNegativeIntegerSchema,
		startedAtMs: nonNegativeIntegerSchema.optional(),
		lastEventAtMs: nonNegativeIntegerSchema.optional(),
		turnCount: nonNegativeIntegerSchema,
		eventCount: nonNegativeIntegerSchema,
		toolUpdateCount: nonNegativeIntegerSchema,
		messageCount: nonNegativeIntegerSchema,
		seenTurnIds: z.array(z.string()).readonly(),
		lastMessage: z.string(),
		activity: z.string(),
		lastMeaningful: z.string(),
		check: workCheckSchema,
		commands: z.array(z.string()).readonly(),
		observations: z.array(z.string()).readonly(),
		timeline: z.array(timelineEntrySchema).readonly(),
		tokens: tokenUsageProjectionSchema.optional(),
		transcript: agentTranscriptReferenceSchema.optional(),
		operatorActions: z.array(operatorActionSchema).readonly().optional(),
	})
	.strict();
export type RunningWorkProjection = z.infer<typeof runningWorkProjectionSchema>;

export const completedWorkProjectionSchema = z
	.object({
		workKey: z.string(),
		label: z.string(),
		status: z.string(),
		message: z.string(),
		atMs: nonNegativeIntegerSchema,
		url: z.string().optional(),
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
		running: z.map(z.string(), runningWorkProjectionSchema).readonly(),
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
	running: new Map(),
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

const eventSummary = (record: Extract<PlotServerRecord, { kind: "event" }>) => {
	const event = record.event;
	if (!isRecord(event)) return "event";
	if (event["type"] === "plot_agent_event" && isRecord(event["event"])) {
		return text(event["event"]["type"]) ?? "plot_agent_event";
	}
	if (event["type"] === "agent_session_event") {
		return text(event["eventType"]) ?? "agent_session_event";
	}
	return text(event["type"]) ?? "event";
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

const inlineText = (value: string, max = 140) =>
	value.replace(/\s+/g, " ").trim().slice(0, max);

type FieldPath = readonly (string | number)[];

const pathValue = (value: unknown, path: FieldPath): unknown => {
	let current = value;
	for (const key of path) {
		if (typeof key === "number") {
			if (!Array.isArray(current)) return undefined;
			current = current[key];
			continue;
		}
		if (!isRecord(current)) return undefined;
		current = current[key];
	}
	return current;
};

const firstPath = (value: unknown, paths: readonly FieldPath[]) => {
	for (const path of paths) {
		const found = pathValue(value, path);
		if (found !== undefined) return found;
	}
	return undefined;
};

const deltaPaths: readonly FieldPath[] = [
	["delta"],
	["text"],
	["content"],
	["summary"],
	["message", "delta"],
	["message", "text"],
	["message", "content"],
	["message", "summary"],
	["params", "delta"],
	["params", "text"],
	["params", "content"],
	["params", "textDelta"],
	["params", "outputDelta"],
	["params", "summaryText"],
	["params", "msg", "delta"],
	["params", "msg", "text"],
	["params", "msg", "content"],
	["params", "msg", "textDelta"],
	["params", "msg", "outputDelta"],
	["params", "msg", "summaryText"],
	["params", "msg", "payload", "delta"],
	["params", "msg", "payload", "text"],
	["params", "msg", "payload", "content"],
	["params", "msg", "payload", "textDelta"],
	["params", "msg", "payload", "outputDelta"],
	["params", "msg", "payload", "summaryText"],
	["partialResult", "content", 0, "text"],
	["partialResult", "details", "text"],
	["partialResult", "details", "message"],
	["partialResult", "details", "summary"],
];

const extractDeltaPreview = (event: unknown) => {
	const delta = firstPath(event, deltaPaths);
	if (typeof delta !== "string") return undefined;
	const trimmed = inlineText(delta);
	return trimmed.length === 0 ? undefined : trimmed;
};

const humanizeStreamingEvent = (label: string, event: unknown) => {
	const preview = extractDeltaPreview(event);
	return preview === undefined ? label : `${label}: ${preview}`;
};

const summarizeAgentEvent = (event: unknown): string => {
	if (!isRecord(event)) return "agent event";
	const type = text(event["type"]);
	if (type === "message_update" || type === "message_delta")
		return humanizeStreamingEvent("agent message streaming", event);
	if (type === "reasoning_update" || type === "reasoning_delta")
		return humanizeStreamingEvent("reasoning streaming", event);
	if (type === "tool_execution_update")
		return humanizeStreamingEvent("command output streaming", event);
	const candidates = [
		event["message"],
		event["text"],
		event["summary"],
		event["command"],
		event["name"],
		type,
	];
	for (const candidate of candidates) {
		if (typeof candidate === "string" && candidate.length > 0) {
			return inlineText(candidate, 120);
		}
	}
	const preview = extractDeltaPreview(event);
	if (preview !== undefined) return `agent message streaming: ${preview}`;
	return inlineText(JSON.stringify(event), 120);
};

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

// pi-mono attaches per-call Usage to the assistant message on message_end:
// event.message.usage = { input, output, totalTokens, cost: { total } }.
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
	previous: RunningWorkProjection["tokens"],
	delta: UsageDelta,
): NonNullable<RunningWorkProjection["tokens"]> => ({
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

const rawEventType = (event: unknown, fallback: string) =>
	isRecord(event) ? (text(event["type"]) ?? fallback) : fallback;

const toolCommand = (event: unknown, fallback: string) => {
	if (!isRecord(event)) return fallback;
	const input = isRecord(event["input"]) ? event["input"] : undefined;
	const candidates = [
		event["command"],
		input?.["command"],
		event["cmd"],
		event["name"],
		event["toolName"],
		fallback,
	];
	for (const candidate of candidates) {
		if (typeof candidate === "string" && candidate.length > 0) {
			return candidate.replace(/\s+/g, " ").slice(0, 140);
		}
	}
	return fallback;
};

const turnId = (event: unknown, sequence: number) => {
	if (!isRecord(event)) return `seq:${sequence}`;
	const candidates = [event["turnId"], event["id"], event["turn_id"]];
	for (const candidate of candidates) {
		if (typeof candidate === "string" && candidate.length > 0) return candidate;
	}
	const turn = isRecord(event["turn"]) ? event["turn"] : undefined;
	if (typeof turn?.["id"] === "string") return turn["id"];
	return `seq:${sequence}`;
};

const isMessageDelta = (eventType: string, type: string) =>
	/^message_(start|update|end)$/.test(eventType) ||
	/^message_(start|update|end)$/.test(type);

const isToolUpdate = (eventType: string, type: string) =>
	eventType === "tool_execution_update" || type === "tool_execution_update";

const isToolStart = (eventType: string, type: string) =>
	eventType === "tool_execution_start" ||
	type === "tool_execution_start" ||
	eventType === "tool_call" ||
	type === "tool_call";

const isToolEnd = (eventType: string, type: string) =>
	eventType === "tool_execution_end" ||
	type === "tool_execution_end" ||
	eventType === "tool_call_completed" ||
	type === "tool_call_completed";

const isTurnStart = (eventType: string, type: string) =>
	eventType === "turn_start" || type === "turn_start";

const isTurnEnd = (eventType: string, type: string) =>
	eventType === "turn_end" || type === "turn_end";

const isObservation = (message: string) =>
	/\b(note|observation|finding|issue|warning|error)\b/i.test(message);
const isCommand = (message: string) =>
	/^(gh|git|rg|bun|npm|pnpm|yarn|node)\b|\b(gh|git|rg|bun)\s/.test(message);

const inferStage = (message: string, eventType: string): WorkStage => {
	const haystack = `${eventType} ${message}`.toLowerCase();
	if (haystack.includes("auth")) return "blocked";
	if (haystack.includes("error") || haystack.includes("failed"))
		return "failed";
	if (
		haystack.includes("gh pr review") ||
		haystack.includes("/reviews") ||
		haystack.includes("post") ||
		haystack.includes("publish")
	)
		return "finishing";
	if (
		haystack.includes("bun run check") ||
		haystack.includes("bun run test") ||
		haystack.includes("typecheck")
	)
		return "verifying";
	if (
		haystack.includes("read") ||
		haystack.includes("edit") ||
		haystack.includes("file") ||
		haystack.includes("search") ||
		haystack.includes("rg ") ||
		haystack.includes("git ") ||
		haystack.includes("diff") ||
		haystack.includes("tool") ||
		haystack.includes("command") ||
		haystack.includes("turn_start") ||
		haystack.includes("message")
	)
		return "working";
	return "waiting";
};

const activityFor = (message: string, eventType: string, rawType: string) => {
	if (isTurnStart(eventType, rawType)) return "Thinking";
	if (isTurnEnd(eventType, rawType)) return "Turn finished";
	if (isToolStart(eventType, rawType)) return `Running: ${message}`;
	if (isToolEnd(eventType, rawType)) return `Ran: ${message}`;
	if (isMessageDelta(eventType, rawType)) return message;
	if (isToolUpdate(eventType, rawType)) return message;
	return message;
};

const isMeaningful = (eventType: string, rawType: string) =>
	isTurnStart(eventType, rawType) ||
	isTurnEnd(eventType, rawType) ||
	isToolStart(eventType, rawType) ||
	isToolEnd(eventType, rawType) ||
	(!isMessageDelta(eventType, rawType) && !isToolUpdate(eventType, rawType));

const inferCheck = (
	previous: RunningWorkProjection["check"],
	message: string,
): RunningWorkProjection["check"] => {
	const lower = message.toLowerCase();
	if (
		lower.includes("bun run check") ||
		lower.includes("bun run test") ||
		lower.includes("typecheck")
	)
		return "running";
	if (previous === "running" && lower.includes("pass")) return "passed";
	if (previous === "running" && lower.includes("fail")) return "failed";
	return previous;
};

export const workLabel = (work: {
	readonly primary?: string | undefined;
	readonly title: string;
}) =>
	work.primary === undefined ? work.title : `${work.primary} ${work.title}`;

export const applySnapshot = (
	projection: DashboardProjection,
	data: unknown,
): DashboardProjection => {
	const snapshot =
		isRecord(data) && isRecord(data["snapshot"]) ? data["snapshot"] : undefined;
	if (!snapshot) return projection;
	const runningValues =
		snapshot["running"] instanceof Map ? [...snapshot["running"].values()] : [];
	const running = new Map(projection.running);
	for (const run of runningValues) {
		if (!isRecord(run)) continue;
		const workKey = text(run["workKey"]) ?? "work";
		const subject = text(run["subject"]);
		const previous = running.get(workKey);
		const display = displayFrom(run["display"]);
		const primary = previous?.primary ?? displayString(display, "primary");
		const title = displayString(display, "title");
		const subtitle = previous?.subtitle ?? displayString(display, "subtitle");
		const url = previous?.url ?? displayString(display, "url");
		const labels = displayLabels(display);
		running.set(workKey, {
			workKey,
			runId: text(run["runId"]) ?? previous?.runId ?? "run",
			sourceId: text(run["sourceId"]) ?? previous?.sourceId ?? "source",
			...(subject === undefined ? {} : { subject }),
			...(primary === undefined ? {} : { primary }),
			title: previous?.title ?? title ?? subtitle ?? subject ?? workKey,
			...(subtitle === undefined ? {} : { subtitle }),
			...(url === undefined ? {} : { url }),
			stage: previous?.stage ?? "waiting",
			startedAtSeq: previous?.startedAtSeq ?? projection.frontier,
			lastEventSeq: previous?.lastEventSeq ?? projection.frontier,
			...(previous?.startedAtMs === undefined
				? {}
				: { startedAtMs: previous.startedAtMs }),
			...(previous?.lastEventAtMs === undefined
				? {}
				: { lastEventAtMs: previous.lastEventAtMs }),
			turnCount: previous?.turnCount ?? 0,
			eventCount: previous?.eventCount ?? 0,
			toolUpdateCount: previous?.toolUpdateCount ?? 0,
			messageCount: previous?.messageCount ?? 0,
			seenTurnIds: previous?.seenTurnIds ?? [],
			lastMessage: previous?.lastMessage ?? (labels.join(",") || "started"),
			activity: previous?.activity ?? "Waiting to start",
			lastMeaningful: previous?.lastMeaningful ?? "started",
			check: previous?.check ?? "not-run",
			commands: previous?.commands ?? [],
			observations: previous?.observations ?? [],
			timeline: previous?.timeline ?? [],
			...(previous?.tokens === undefined ? {} : { tokens: previous.tokens }),
		});
	}
	for (const key of running.keys()) {
		if (
			!runningValues.some(
				(run) => isRecord(run) && text(run["workKey"]) === key,
			)
		)
			running.delete(key);
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
		? snapshot["diagnostics"]
				.slice(-5)
				.map((d) =>
					isRecord(d)
						? `${text(d["level"]) ?? "diagnostic"}/${text(d["phase"]) ?? "unknown"}: ${text(d["message"]) ?? JSON.stringify(d)}`
						: String(d),
				)
		: projection.diagnostics;
	return { ...projection, running, diagnostics, scheduledWakes };
};

const reduceTickCompleted = (
	projection: DashboardProjection,
	result: unknown,
	observedAtMs: number,
): DashboardProjection => {
	if (!isRecord(result)) return projection;
	const tickId = typeof result["tickId"] === "number" ? result["tickId"] : 0;
	const found = Array.isArray(result["selected"])
		? result["selected"].length
		: 0;
	const started = Array.isArray(result["started"])
		? result["started"].length
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
	return { ...projection, pulse, activity };
};

const reduceWorkStarted = (
	projection: DashboardProjection,
	run: Record<string, unknown>,
	sequence: number,
	observedAtMs: number,
): DashboardProjection => {
	const workKey = text(run["workKey"]) ?? "work";
	const subject = text(run["subject"]);
	const running = new Map(projection.running);
	const display = displayFrom(run["display"]);
	const primary = displayString(display, "primary");
	const title = displayString(display, "title");
	const subtitle = displayString(display, "subtitle");
	const url = displayString(display, "url");
	const labels = displayLabels(display);
	const work: RunningWorkProjection = {
		workKey,
		runId: text(run["runId"]) ?? "run",
		sourceId: text(run["sourceId"]) ?? "source",
		...(subject === undefined ? {} : { subject }),
		...(primary === undefined ? {} : { primary }),
		title: title ?? subtitle ?? subject ?? workKey,
		...(subtitle === undefined ? {} : { subtitle }),
		...(url === undefined ? {} : { url }),
		stage: "starting",
		startedAtSeq: sequence,
		lastEventSeq: sequence,
		startedAtMs: observedAtMs,
		lastEventAtMs: observedAtMs,
		turnCount: 0,
		eventCount: 0,
		toolUpdateCount: 0,
		messageCount: 0,
		seenTurnIds: [],
		lastMessage: labels.join(",") || "started",
		activity: "Starting work",
		lastMeaningful: "started",
		check: "not-run",
		commands: [],
		observations: [],
		timeline: [{ atMs: observedAtMs, text: "work started" }],
	};
	running.set(workKey, work);
	return {
		...projection,
		running,
		activity: prependActivity(projection.activity, {
			atMs: observedAtMs,
			tone: "info",
			text: `${workLabel(work)} started`,
		}),
	};
};

const reduceWorkCompleted = (
	projection: DashboardProjection,
	completion: Record<string, unknown>,
	observedAtMs: number,
): DashboardProjection => {
	const workKey = text(completion["workKey"]) ?? "work";
	const status = text(completion["status"]) ?? "completed";
	const error = text(completion["error"]);
	const running = new Map(projection.running);
	const prior = running.get(workKey);
	running.delete(workKey);
	const label = prior === undefined ? workKey : workLabel(prior);
	const ok = status === "succeeded";
	return {
		...projection,
		running,
		activity: prependActivity(projection.activity, {
			atMs: observedAtMs,
			tone: ok ? "ok" : "bad",
			text: `${label} ${status}${error === undefined ? "" : ` · ${error}`}`,
		}),
		completed: [
			{
				workKey,
				label,
				status,
				message: error ?? "completed",
				atMs: observedAtMs,
				...(prior?.url === undefined ? {} : { url: prior.url }),
			},
			...projection.completed,
		].slice(0, 20),
	};
};

export const reduceRecord = (
	projection: DashboardProjection,
	record: PlotServerRecord,
): DashboardProjection => {
	if (record.kind !== "event") return projection;
	const sequence = Number(record.sequence);
	const observedAtMs = Date.now();
	const summary = eventSummary(record);
	let next: DashboardProjection = {
		...projection,
		frontier: sequence,
		debugEvents: [
			`#${record.sequence} ${summary}`,
			...projection.debugEvents,
		].slice(0, 100),
	};
	const event = record.event;
	if (!isRecord(event)) return next;
	if (event["type"] === "plot_agent_event" && isRecord(event["event"])) {
		const agentEvent = event["event"];
		if (agentEvent["type"] === "tick_completed")
			return reduceTickCompleted(next, agentEvent["result"], observedAtMs);
		if (agentEvent["type"] === "work_started" && isRecord(agentEvent["run"]))
			return reduceWorkStarted(next, agentEvent["run"], sequence, observedAtMs);
		if (
			agentEvent["type"] === "work_completed" &&
			isRecord(agentEvent["completion"])
		)
			return reduceWorkCompleted(next, agentEvent["completion"], observedAtMs);
		return next;
	}
	if (event["type"] === "agent_session_event") {
		const workKey = text(event["workKey"]);
		if (workKey === undefined) return next;
		const rawEvent = event["event"];
		const eventType = text(event["eventType"]) ?? "agent";
		const rawType = rawEventType(rawEvent, eventType);
		const message =
			isToolStart(eventType, rawType) || isToolEnd(eventType, rawType)
				? toolCommand(rawEvent, summarizeAgentEvent(rawEvent))
				: summarizeAgentEvent(rawEvent);
		const running = new Map(next.running);
		const previous = running.get(workKey);
		const subject = text(event["subject"]) ?? previous?.subject;
		const usage = extractUsage(rawEvent);
		const tokens =
			usage === undefined
				? previous?.tokens
				: addUsage(previous?.tokens, usage);
		const usageTotals =
			usage === undefined
				? next.usageTotals
				: {
						tokens: next.usageTotals.tokens + usage.total,
						cost: (next.usageTotals.cost ?? 0) + (usage.cost ?? 0),
					};
		const tokenSamples =
			usage === undefined
				? next.tokenSamples
				: appendSample(next.tokenSamples, {
						atMs: observedAtMs,
						tokens: usageTotals.tokens,
					});
		const commands = isCommand(message)
			? appendBounded(previous?.commands ?? [], message, 8)
			: (previous?.commands ?? []);
		const observations = isObservation(message)
			? appendBounded(previous?.observations ?? [], message, 8)
			: (previous?.observations ?? []);
		const priorTurnIds = previous?.seenTurnIds ?? [];
		const id = isTurnStart(eventType, rawType)
			? turnId(rawEvent, sequence)
			: undefined;
		const seenTurnIds =
			id !== undefined && !priorTurnIds.includes(id)
				? [...priorTurnIds, id]
				: priorTurnIds;
		const activity = activityFor(message, eventType, rawType);
		const meaningful = isMeaningful(eventType, rawType);
		const lastMeaningful = meaningful
			? activity
			: (previous?.lastMeaningful ?? "waiting");
		const timeline = meaningful
			? prependTimeline(
					previous?.timeline ?? [],
					{ atMs: observedAtMs, text: activity },
					12,
				)
			: (previous?.timeline ?? []);
		running.set(workKey, {
			workKey,
			runId: text(event["runId"]) ?? previous?.runId ?? "run",
			sourceId: text(event["sourceId"]) ?? previous?.sourceId ?? "source",
			...(subject === undefined ? {} : { subject }),
			...(previous?.primary === undefined ? {} : { primary: previous.primary }),
			title: previous?.title ?? subject ?? workKey,
			...(previous?.subtitle === undefined
				? {}
				: { subtitle: previous.subtitle }),
			...(previous?.url === undefined ? {} : { url: previous.url }),
			stage: inferStage(message, `${eventType} ${rawType}`),
			startedAtSeq: previous?.startedAtSeq ?? sequence,
			lastEventSeq: sequence,
			startedAtMs: previous?.startedAtMs ?? observedAtMs,
			lastEventAtMs: observedAtMs,
			turnCount: seenTurnIds.length,
			eventCount: (previous?.eventCount ?? 0) + 1,
			toolUpdateCount:
				(previous?.toolUpdateCount ?? 0) +
				(isToolUpdate(eventType, rawType) ? 1 : 0),
			messageCount:
				(previous?.messageCount ?? 0) +
				(isMessageDelta(eventType, rawType) ? 1 : 0),
			seenTurnIds,
			lastMessage: message,
			activity,
			lastMeaningful,
			check: inferCheck(previous?.check ?? "not-run", message),
			commands,
			observations,
			timeline,
			...(tokens === undefined ? {} : { tokens }),
		});
		return { ...next, usageTotals, tokenSamples, running };
	}
	return next;
};
