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

// The tool currently executing in a run. pi-mono runs one tool at a time per
// agent, and `tool_execution_end` carries no args — so we remember the start's
// target/kind/check-ness here to attribute the completion correctly.
export const activeToolSchema = z
	.object({
		kind: activityKindSchema,
		isCheck: z.boolean(),
		target: z.string().optional(),
		toolCallId: z.string().optional(),
	})
	.strict();
export type ActiveTool = z.infer<typeof activeToolSchema>;

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
		phases: z.array(phaseEntrySchema).readonly(),
		timeline: z.array(timelineEntrySchema).readonly(),
		activeTool: activeToolSchema.optional(),
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

const messageDelta = (event: Record<string, unknown>): string | undefined => {
	const ame = event["assistantMessageEvent"];
	if (isRecord(ame)) {
		const delta = text(ame["delta"]);
		if (delta !== undefined && delta.trim().length > 0)
			return inlineText(delta, 120);
	}
	return undefined;
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
	readonly delta?: string;
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
		const isBash = toolName === "bash";
		const isCheck = isBash && target !== undefined && isCheckCommand(target);
		const isFinish = isBash && target !== undefined && isFinishCommand(target);
		const kind: ActivityKind = isCheck
			? "test"
			: isFinish
				? "finish"
				: (TOOL_KIND[toolName] ?? "run");
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
		const delta = messageDelta(raw);
		return { ...base, type, phase: "message", ...(delta ? { delta } : {}) };
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

const isObservation = (message: string) =>
	/\b(note|observation|finding|issue|warning|error)\b/i.test(message);

const deriveStage = (
	previous: WorkStage,
	kind: ActivityKind,
	phase: EventPhase,
	isError: boolean,
	hasOperatorActions: boolean,
): WorkStage => {
	if (hasOperatorActions) return "blocked";
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

const baseRunningWork = (
	workKey: string,
	runId: string,
	sourceId: string,
	stage: WorkStage,
	seq: number,
	atMs: number | undefined,
): RunningWorkProjection => ({
	workKey,
	runId,
	sourceId,
	title: workKey,
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
	const runningValues = mapValues(snapshot["running"]);
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
		const parsedActions = z
			.array(operatorActionSchema)
			.safeParse(run["operatorActions"]);
		const operatorActions = parsedActions.success
			? parsedActions.data
			: previous?.operatorActions;
		const fresh = baseRunningWork(
			workKey,
			text(run["runId"]) ?? previous?.runId ?? "run",
			text(run["sourceId"]) ?? previous?.sourceId ?? "source",
			operatorActions !== undefined && operatorActions.length > 0
				? "blocked"
				: (previous?.stage ?? "waiting"),
			previous?.startedAtSeq ?? projection.frontier,
			previous?.startedAtMs,
		);
		running.set(workKey, {
			...fresh,
			...previous,
			workKey,
			...(subject === undefined ? {} : { subject }),
			...(primary === undefined ? {} : { primary }),
			title: previous?.title ?? title ?? subtitle ?? subject ?? workKey,
			...(subtitle === undefined ? {} : { subtitle }),
			...(url === undefined ? {} : { url }),
			stage:
				operatorActions !== undefined && operatorActions.length > 0
					? "blocked"
					: (previous?.stage ?? "waiting"),
			lastMeaningful:
				previous?.lastMeaningful ?? (labels.join(",") || "started"),
			...(operatorActions === undefined ? {} : { operatorActions }),
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
		? snapshot["diagnostics"].slice(-5).map(diagnosticText)
		: projection.diagnostics;
	const frontier =
		asOfSequence === undefined
			? projection.frontier
			: Math.max(projection.frontier, asOfSequence);
	return { ...projection, frontier, running, diagnostics, scheduledWakes };
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
	const diagnostics = Array.isArray(result["diagnostics"])
		? [
				...result["diagnostics"].map(diagnosticText),
				...projection.diagnostics,
			].slice(0, 5)
		: projection.diagnostics;
	return { ...projection, status: "idle", pulse, activity, diagnostics };
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
	const parsedActions = z
		.array(operatorActionSchema)
		.safeParse(run["operatorActions"]);
	const operatorActions = parsedActions.success
		? parsedActions.data
		: undefined;
	const blocked = operatorActions !== undefined && operatorActions.length > 0;
	const base = baseRunningWork(
		workKey,
		text(run["runId"]) ?? "run",
		text(run["sourceId"]) ?? "source",
		blocked ? "blocked" : "starting",
		sequence,
		observedAtMs,
	);
	const work: RunningWorkProjection = {
		...base,
		...(subject === undefined ? {} : { subject }),
		...(primary === undefined ? {} : { primary }),
		title: title ?? subtitle ?? subject ?? workKey,
		...(subtitle === undefined ? {} : { subtitle }),
		...(url === undefined ? {} : { url }),
		activity: "Starting work",
		lastMeaningful: labels.join(",") || "started",
		timeline: [{ atMs: observedAtMs, text: "work started", kind: "wait" }],
		...(operatorActions === undefined ? {} : { operatorActions }),
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
	if (workKey === undefined) return projection;
	const running = new Map(projection.running);
	const previous = running.get(workKey);
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

	// tool_execution_end carries no args, so resolve the completed tool's
	// kind/target/check-ness from the start we remembered in activeTool.
	const active = previous.activeTool;
	const kind: ActivityKind =
		classified.phase === "end"
			? (active?.kind ?? classified.kind)
			: classified.kind;
	const target =
		classified.phase === "end"
			? (classified.target ?? active?.target)
			: classified.target;
	const isCheck =
		classified.phase === "end"
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

	// The live "now" line — resolved here so views render it verbatim.
	const streaming =
		classified.phase === "update" || classified.phase === "message";
	const activity =
		classified.phase === "message"
			? (classified.delta ?? previous.activity)
			: classified.phase === "turn"
				? "Thinking"
				: classified.phase === "start" || classified.phase === "update"
					? liveLabel(kind, target)
					: classified.phase === "end"
						? doneLabel(kind, target, classified.isError)
						: previous.activity;
	const activityKind =
		classified.phase === "message"
			? "message"
			: classified.phase === "none"
				? previous.activityKind
				: classified.phase === "turn"
					? "think"
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

	const observations =
		timelineWorthy && isObservation(timelineText)
			? appendBounded(previous.observations, timelineText, 8)
			: previous.observations;

	const check = isCheck
		? classified.phase === "start" || classified.phase === "update"
			? "running"
			: classified.phase === "end"
				? classified.isError
					? "failed"
					: "passed"
				: previous.check
		: previous.check;

	const hasOperatorActions =
		previous.operatorActions !== undefined &&
		previous.operatorActions.length > 0;

	const next: RunningWorkProjection = {
		...previous,
		runId: text(event["runId"]) ?? previous.runId,
		sourceId: text(event["sourceId"]) ?? previous.sourceId,
		...(subject === undefined ? {} : { subject }),
		stage: deriveStage(
			previous.stage,
			kind,
			classified.phase,
			classified.isError,
			hasOperatorActions,
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
		phases,
		timeline,
		...(tokens === undefined ? {} : { tokens }),
	};
	// Track / clear the in-flight tool for end-event attribution.
	if (classified.phase === "start") {
		next.activeTool = {
			kind,
			isCheck,
			...(target === undefined ? {} : { target }),
			...(classified.toolCallId === undefined
				? {}
				: { toolCallId: classified.toolCallId }),
		};
	} else if (classified.phase === "end") {
		delete next.activeTool;
	}
	running.set(workKey, next);
	return { ...projection, usageTotals, tokenSamples, running };
};

const reduceOperatorActionsDeclared = (
	projection: DashboardProjection,
	payload: Record<string, unknown>,
): DashboardProjection => {
	const workKey = text(payload["workKey"]);
	if (workKey === undefined) return projection;
	const parsed = z.array(operatorActionSchema).safeParse(payload["actions"]);
	if (!parsed.success) return projection;
	const running = new Map(projection.running);
	const previous = running.get(workKey);
	if (previous === undefined) return projection;
	running.set(workKey, {
		...previous,
		operatorActions: parsed.data,
		stage: parsed.data.length > 0 ? "blocked" : previous.stage,
		lastMeaningful:
			parsed.data.length > 0
				? "operator action declared"
				: previous.lastMeaningful,
	});
	return { ...projection, running };
};

const reduceEventPayload = (
	projection: DashboardProjection,
	type: string,
	payload: unknown,
	sequence: number,
	observedAtMs: number,
): DashboardProjection => {
	if (type === "session_started") return { ...projection, status: "running" };
	if (type === "session_paused") return { ...projection, status: "paused" };
	if (type === "session_resumed") return { ...projection, status: "idle" };
	if (type === "session_close_requested")
		return { ...projection, status: "shutting_down" };
	if (type === "session_shutdown" || type === "session_close_completed")
		return { ...projection, status: "stopped" };
	if (type === "tick_started")
		return reduceTickStarted(
			projection,
			isRecord(payload) ? payload["tickId"] : undefined,
			observedAtMs,
		);
	if (type === "tick_completed")
		return reduceTickCompleted(
			projection,
			isRecord(payload) && payload["result"] !== undefined
				? payload["result"]
				: payload,
			observedAtMs,
		);
	if (type === "work_started" && isRecord(payload)) {
		const run = isRecord(payload["run"]) ? payload["run"] : payload;
		return reduceWorkStarted(projection, run, sequence, observedAtMs);
	}
	if (
		(type === "work_completed" ||
			type === "agent_run_completed" ||
			type === "agent_run_interrupted") &&
		isRecord(payload)
	) {
		const completion = isRecord(payload["completion"])
			? payload["completion"]
			: payload;
		return reduceWorkCompleted(projection, completion, observedAtMs);
	}
	if (
		(type === "agent_session_event" || type === "agent_run_event") &&
		isRecord(payload)
	)
		return reduceAgentSessionEvent(projection, payload, sequence, observedAtMs);
	if (type === "wake_scheduled" && isRecord(payload))
		return reduceWakeScheduled(projection, payload, observedAtMs);
	if (
		(type === "diagnostic_recorded" || type === "diagnostic") &&
		isRecord(payload)
	)
		return {
			...projection,
			diagnostics: [diagnosticText(payload), ...projection.diagnostics].slice(
				0,
				5,
			),
		};
	if (type === "operator_actions_declared" && isRecord(payload))
		return reduceOperatorActionsDeclared(projection, payload);
	if (type === "operator_observation_recorded" && isRecord(payload))
		return {
			...projection,
			activity: prependActivity(projection.activity, {
				atMs: observedAtMs,
				tone: "info",
				text: `operator action ${text(payload["actionLabel"]) ?? text(payload["actionId"]) ?? "recorded"}`,
			}),
		};
	return projection;
};

export const reduceRecord = (
	projection: DashboardProjection,
	record: PlotServerRecord,
): DashboardProjection => {
	if (record.kind !== "session_event") return projection;
	const sequence = Number(record.sequence);
	const observedAtMs = Date.now();
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
