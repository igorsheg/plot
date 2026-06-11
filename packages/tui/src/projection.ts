import type { PlotServerRecord } from "@plot/session/protocol";
import type { RuntimeIdentityProjection } from "./runtime-identity.js";

export type TuiStatus =
	| "starting"
	| "idle"
	| "running"
	| "shutting_down"
	| "stopped"
	| "error";

export type WorkStage =
	| "exploring"
	| "reading"
	| "testing"
	| "acting"
	| "publishing"
	| "waiting"
	| "blocked"
	| "failed";

export interface RunningWorkProjection {
	readonly workKey: string;
	readonly runId: string;
	readonly sourceId: string;
	readonly subject?: string;
	readonly primary?: string;
	readonly title: string;
	readonly stage: WorkStage;
	readonly startedAtSeq: number;
	readonly lastEventSeq: number;
	readonly startedAtMs?: number;
	readonly lastEventAtMs?: number;
	readonly turnCount: number;
	readonly lastMessage: string;
	readonly check: "not-run" | "running" | "passed" | "failed";
	readonly commands: readonly string[];
	readonly observations: readonly string[];
	readonly timeline: readonly string[];
	readonly tokens?: {
		readonly input?: number;
		readonly output?: number;
		readonly total?: number;
	};
}

export interface CompletedWorkProjection {
	readonly workKey: string;
	readonly status: string;
	readonly message: string;
}

export interface ScheduledWakeProjection {
	readonly dueAtMs: number;
	readonly delayMs: number;
	readonly reason?: string;
}

export interface DashboardProjection {
	readonly sessionId: string;
	readonly workflowName: string;
	readonly runtime: RuntimeIdentityProjection;
	readonly status: TuiStatus;
	readonly frontier: number;
	readonly running: ReadonlyMap<string, RunningWorkProjection>;
	readonly completed: readonly CompletedWorkProjection[];
	readonly diagnostics: readonly string[];
	readonly scheduledWakes: readonly ScheduledWakeProjection[];
	readonly timeline: readonly string[];
	readonly debugEvents: readonly string[];
}

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
	running: new Map(),
	completed: [],
	diagnostics: [],
	scheduledWakes: [],
	timeline: [],
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

const summarizeAgentEvent = (event: unknown): string => {
	if (!isRecord(event)) return "agent event";
	const candidates = [
		event["message"],
		event["text"],
		event["summary"],
		event["command"],
		event["name"],
		event["type"],
	];
	for (const candidate of candidates) {
		if (typeof candidate === "string" && candidate.length > 0) {
			return candidate.replace(/\s+/g, " ").slice(0, 120);
		}
	}
	return JSON.stringify(event).replace(/\s+/g, " ").slice(0, 120);
};

const extractTokens = (event: unknown) => {
	if (!isRecord(event)) return undefined;
	const usage = isRecord(event["usage"]) ? event["usage"] : event;
	const input =
		typeof usage["input"] === "number"
			? usage["input"]
			: typeof usage["inputTokens"] === "number"
				? usage["inputTokens"]
				: undefined;
	const output =
		typeof usage["output"] === "number"
			? usage["output"]
			: typeof usage["outputTokens"] === "number"
				? usage["outputTokens"]
				: undefined;
	const total =
		typeof usage["total"] === "number"
			? usage["total"]
			: typeof usage["totalTokens"] === "number"
				? usage["totalTokens"]
				: input !== undefined || output !== undefined
					? (input ?? 0) + (output ?? 0)
					: undefined;
	return input === undefined && output === undefined && total === undefined
		? undefined
		: {
				...(input === undefined ? {} : { input }),
				...(output === undefined ? {} : { output }),
				...(total === undefined ? {} : { total }),
			};
};

const appendBounded = (items: readonly string[], item: string, max: number) =>
	[item, ...items.filter((existing) => existing !== item)].slice(0, max);

const isObservation = (message: string) =>
	/\b(note|observation|finding|issue|warning|error)\b/i.test(message);
const isCommand = (message: string) =>
	/^(gh|git|rg|bun|npm|pnpm|yarn|node)\b|\b(gh|git|rg|bun)\s/.test(message);

const inferStage = (message: string, eventType: string): WorkStage => {
	const haystack = `${eventType} ${message}`.toLowerCase();
	if (haystack.includes("auth")) return "blocked";
	if (haystack.includes("error") || haystack.includes("failed"))
		return "failed";
	if (haystack.includes("post") || haystack.includes("publish"))
		return "publishing";
	if (
		haystack.includes("bun run check") ||
		haystack.includes("bun run test") ||
		haystack.includes("typecheck")
	)
		return "testing";
	if (
		haystack.includes("read") ||
		haystack.includes("edit") ||
		haystack.includes("file")
	)
		return "reading";
	if (
		haystack.includes("search") ||
		haystack.includes("rg ") ||
		haystack.includes("git ") ||
		haystack.includes("diff")
	)
		return "exploring";
	if (haystack.includes("tool") || haystack.includes("command"))
		return "acting";
	return "waiting";
};

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
		const primary = displayString(display, "primary");
		const title = displayString(display, "title");
		const subtitle = displayString(display, "subtitle");
		const labels = displayLabels(display);
		const displayPrimary = previous?.primary ?? primary;
		running.set(workKey, {
			workKey,
			runId: text(run["runId"]) ?? previous?.runId ?? "run",
			sourceId: text(run["sourceId"]) ?? previous?.sourceId ?? "source",
			...(subject === undefined ? {} : { subject }),
			...(displayPrimary === undefined ? {} : { primary: displayPrimary }),
			title: previous?.title ?? title ?? subtitle ?? subject ?? workKey,
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
			lastMessage: previous?.lastMessage ?? (labels.join(",") || "started"),
			check: previous?.check ?? "not-run",
			commands: previous?.commands ?? [],
			observations: previous?.observations ?? [],
			timeline: previous?.timeline ?? [],
			...(previous?.tokens === undefined ? {} : { tokens: previous.tokens }),
		});
	}
	for (const key of [...running.keys()]) {
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
				if (typeof dueAtMs !== "number" || typeof delayMs !== "number")
					return [];
				return [
					{
						dueAtMs,
						delayMs,
						...(reason === undefined ? {} : { reason }),
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
		timeline: [`#${record.sequence} ${summary}`, ...projection.timeline].slice(
			0,
			8,
		),
	};
	const event = record.event;
	if (!isRecord(event)) return next;
	if (event["type"] === "plot_agent_event" && isRecord(event["event"])) {
		const agentEvent = event["event"];
		if (agentEvent["type"] === "work_started" && isRecord(agentEvent["run"])) {
			const run = agentEvent["run"];
			const workKey = text(run["workKey"]) ?? "work";
			const subject = text(run["subject"]);
			const running = new Map(next.running);
			const display = displayFrom(run["display"]);
			const primary = displayString(display, "primary");
			const title = displayString(display, "title");
			const subtitle = displayString(display, "subtitle");
			const labels = displayLabels(display);
			running.set(workKey, {
				workKey,
				runId: text(run["runId"]) ?? "run",
				sourceId: text(run["sourceId"]) ?? "source",
				...(subject === undefined ? {} : { subject }),
				...(primary === undefined ? {} : { primary }),
				title: title ?? subtitle ?? subject ?? workKey,
				stage: "waiting",
				startedAtSeq: sequence,
				lastEventSeq: sequence,
				startedAtMs: observedAtMs,
				lastEventAtMs: observedAtMs,
				turnCount: 0,
				lastMessage: labels.join(",") || "started",
				check: "not-run",
				commands: [],
				observations: [],
				timeline: [`#${sequence} started`],
			});
			next = { ...next, running };
		}
		if (
			agentEvent["type"] === "work_completed" &&
			isRecord(agentEvent["completion"])
		) {
			const completion = agentEvent["completion"];
			const workKey = text(completion["workKey"]) ?? "work";
			const running = new Map(next.running);
			running.delete(workKey);
			next = {
				...next,
				running,
				completed: [
					{
						workKey,
						status: text(completion["status"]) ?? "completed",
						message: text(completion["error"]) ?? "completed",
					},
					...next.completed,
				].slice(0, 5),
			};
		}
	}
	if (event["type"] === "agent_session_event") {
		const workKey = text(event["workKey"]);
		if (workKey === undefined) return next;
		const message = summarizeAgentEvent(event["event"]);
		const eventType = text(event["eventType"]) ?? "agent";
		const running = new Map(next.running);
		const previous = running.get(workKey);
		const subject = text(event["subject"]) ?? previous?.subject;
		const rawEvent = event["event"];
		const tokens = extractTokens(rawEvent) ?? previous?.tokens;
		const commands = isCommand(message)
			? appendBounded(previous?.commands ?? [], message, 8)
			: (previous?.commands ?? []);
		const observations = isObservation(message)
			? appendBounded(previous?.observations ?? [], message, 8)
			: (previous?.observations ?? []);
		const timeline = appendBounded(
			previous?.timeline ?? [],
			`#${sequence} ${message}`,
			12,
		);
		running.set(workKey, {
			workKey,
			runId: text(event["runId"]) ?? previous?.runId ?? "run",
			sourceId: text(event["sourceId"]) ?? previous?.sourceId ?? "source",
			...(subject === undefined ? {} : { subject }),
			...(previous?.primary === undefined ? {} : { primary: previous.primary }),
			title: previous?.title ?? subject ?? workKey,
			stage: inferStage(message, eventType),
			startedAtSeq: previous?.startedAtSeq ?? sequence,
			lastEventSeq: sequence,
			startedAtMs: previous?.startedAtMs ?? observedAtMs,
			lastEventAtMs: observedAtMs,
			turnCount: (previous?.turnCount ?? 0) + 1,
			lastMessage: message,
			check: inferCheck(previous?.check ?? "not-run", message),
			commands,
			observations,
			timeline,
			...(tokens === undefined ? {} : { tokens }),
		});
		next = { ...next, running };
	}
	return next;
};
