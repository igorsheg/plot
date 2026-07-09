import { isRecord, type Mutable } from "@plot/common/primitives";
import {
	appendStreamDelta,
	piEventDisplay,
	type PiUsageDelta,
} from "../pi-event-display.js";
import { at, str } from "./helpers.js";
import type {
	ActiveTool,
	ActivityKind,
	AgentAttemptProjection,
	DashboardProjection,
	ProjectableEvent,
} from "./types.js";

const mergeAttempt = (
	a: AgentAttemptProjection,
	patch: Partial<AgentAttemptProjection>,
	e: ProjectableEvent,
): AgentAttemptProjection => ({
	...a,
	lastEventSeq: Number(e.sequence),
	lastEventAtMs: at(e),
	eventCount: a.eventCount + 1,
	...patch,
});

const timeline = (
	a: AgentAttemptProjection,
	text: string,
	kind: ActivityKind,
	when: number,
) => [...a.timeline, { atMs: when, text, kind }].slice(-30);

const activeTool = (tool: {
	readonly kind: ActivityKind;
	readonly check: string;
	readonly target?: string | undefined;
	readonly toolCallId?: string | undefined;
}) => {
	const active: Mutable<ActiveTool> = {
		kind: tool.kind,
		isCheck: tool.check === "running",
	};
	if (tool.target !== undefined) active.target = tool.target;
	if (tool.toolCallId !== undefined) active.toolCallId = tool.toolCallId;
	return active;
};

const lifecycleActivity = (
	prev: AgentAttemptProjection,
	summary: string,
): Partial<AgentAttemptProjection> =>
	prev.meaningfulCount === 0 ? { activity: summary, lastDisplay: summary } : {};

const addUsage = (
	previous: AgentAttemptProjection["tokens"],
	usage: PiUsageDelta,
): NonNullable<AgentAttemptProjection["tokens"]> => ({
	input: (previous?.input ?? 0) + (usage.input ?? 0),
	output: (previous?.output ?? 0) + (usage.output ?? 0),
	total: (previous?.total ?? 0) + usage.total,
	cost: (previous?.cost ?? 0) + (usage.cost ?? 0),
});
const freshUsage = (
	previous: AgentAttemptProjection,
	usage: PiUsageDelta | undefined,
): PiUsageDelta | undefined => {
	if (usage?.key === undefined) return usage;
	return previous.usageKeys?.includes(usage.key) ? undefined : usage;
};

export const reduceAgentEvent = (
	p: DashboardProjection,
	e: ProjectableEvent,
	payloadValue: unknown,
): DashboardProjection => {
	const payload = isRecord(payloadValue) ? payloadValue : undefined;
	if (payload === undefined) return p;
	const runId = str(payload["runId"]);
	if (runId === undefined) return p;
	const rawEvent = isRecord(payload["event"]) ? payload["event"] : {};
	const prev = p.attempts.get(runId);
	if (prev === undefined) return p;
	// Plot's own synthetic event: the Agent Transcript reference.
	if (rawEvent["type"] === "plot_transcript") {
		const path = str(rawEvent["sessionFile"]);
		if (path === undefined) return p;
		const id = str(rawEvent["sessionId"]);
		const transcript: Mutable<
			NonNullable<AgentAttemptProjection["transcript"]>
		> = { path };
		if (id !== undefined) transcript.id = id;
		return {
			...p,
			attempts: new Map(p.attempts).set(
				runId,
				mergeAttempt(prev, { transcript }, e),
			),
		};
	}
	const activity = piEventDisplay(rawEvent);
	if (activity === undefined) return p;
	const when = at(e);
	let appliedUsage: PiUsageDelta | undefined;
	const handlers = {
		turn_start: () => {
			if (activity.type !== "turn_start") return prev;
			return mergeAttempt(
				prev,
				{
					turnCount: prev.turnCount + 1,
					activityKind: "think",
					streaming: true,
					...lifecycleActivity(prev, activity.summary),
				},
				e,
			);
		},
		turn_end: () => {
			if (activity.type !== "turn_end") return prev;
			appliedUsage = freshUsage(prev, activity.usage);
			return mergeAttempt(
				prev,
				{
					streaming: false,
					streams: {},
					...lifecycleActivity(prev, activity.summary),
					...(appliedUsage === undefined
						? {}
						: {
								tokens: addUsage(prev.tokens, appliedUsage),
								...(appliedUsage.key === undefined
									? {}
									: {
											usageKeys: [...(prev.usageKeys ?? []), appliedUsage.key],
										}),
							}),
				},
				e,
			);
		},
		thinking: () => {
			if (activity.type !== "thinking") return prev;
			const text = appendStreamDelta(prev.streams.thinking, activity.delta);
			return mergeAttempt(
				prev,
				{
					activity: activity.summary,
					activityKind: "think",
					streaming: true,
					lastDisplay: activity.summary,
					meaningfulCount: prev.meaningfulCount + 1,
					streams: { ...prev.streams, thinking: text },
					lastNarrative: { kind: "thinking", text },
				},
				e,
			);
		},
		message: () => {
			if (activity.type !== "message") return prev;
			const text = appendStreamDelta(prev.streams.message, activity.delta);
			return mergeAttempt(
				prev,
				{
					messageCount: prev.messageCount + 1,
					activity: activity.summary,
					activityKind: "message",
					streaming: true,
					lastDisplay: activity.summary,
					meaningfulCount: prev.meaningfulCount + 1,
					streams: { ...prev.streams, message: text },
					lastNarrative: { kind: "message", text },
				},
				e,
			);
		},
		tool_start: () => {
			if (activity.type !== "tool_start") return prev;
			const tool = activity.tool;
			const nextActiveTool = activeTool(tool);
			const activeTools = new Map(prev.activeTools ?? []);
			if (tool.toolCallId) activeTools.set(tool.toolCallId, nextActiveTool);
			return mergeAttempt(
				prev,
				{
					stage: tool.stage,
					activity: tool.text,
					activityKind: tool.kind,
					streaming: true,
					lastDisplay: tool.text,
					meaningfulCount: prev.meaningfulCount + 1,
					check: tool.check === "running" ? "running" : prev.check,
					commands:
						tool.kind === "run" ||
						tool.kind === "test" ||
						tool.kind === "finish"
							? [...prev.commands, tool.text]
							: prev.commands,
					activeTool: nextActiveTool,
					activeTools,
					streams: { ...prev.streams, tool: tool.text },
					timeline: timeline(prev, tool.text, tool.kind, when),
				},
				e,
			);
		},
		tool_update: () => {
			if (activity.type !== "tool_update") return prev;
			const tool = activity.tool;
			const nextActiveTool = activeTool(tool);
			const activeTools = new Map(prev.activeTools ?? []);
			if (tool.toolCallId) activeTools.set(tool.toolCallId, nextActiveTool);
			return mergeAttempt(
				prev,
				{
					stage: tool.stage,
					activity: tool.text,
					activityKind: tool.kind,
					streaming: true,
					lastDisplay: tool.text,
					meaningfulCount: prev.meaningfulCount + 1,
					check: tool.check === "running" ? "running" : prev.check,
					toolUpdateCount: prev.toolUpdateCount + 1,
					activeTool: nextActiveTool,
					activeTools,
					streams: { ...prev.streams, tool: tool.text },
				},
				e,
			);
		},
		tool_end: () => {
			if (activity.type !== "tool_end") return prev;
			const activeTools = new Map(prev.activeTools ?? []);
			const active = activity.toolCallId
				? activeTools.get(activity.toolCallId)
				: prev.activeTool;
			if (activity.toolCallId) activeTools.delete(activity.toolCallId);
			return mergeAttempt(
				prev,
				{
					stage: activity.failed ? "failed" : prev.stage,
					check: active?.isCheck
						? activity.failed
							? "failed"
							: "passed"
						: prev.check,
					streaming: activeTools.size > 0,
					activeTools,
					activeTool: activeTools.values().next().value,
					streams: { ...prev.streams, tool: undefined },
				},
				e,
			);
		},
	} satisfies Record<typeof activity.type, () => AgentAttemptProjection>;
	const next = handlers[activity.type]();
	const attempts = new Map(p.attempts).set(runId, next);
	const usageTotals =
		appliedUsage === undefined
			? p.usageTotals
			: {
					tokens: p.usageTotals.tokens + appliedUsage.total,
					...(appliedUsage.cost === undefined &&
					p.usageTotals.cost === undefined
						? {}
						: {
								cost: (p.usageTotals.cost ?? 0) + (appliedUsage.cost ?? 0),
							}),
				};
	return {
		...p,
		attempts,
		usageTotals,
		tokenSamples:
			usageTotals === p.usageTotals
				? p.tokenSamples
				: [...p.tokenSamples, { atMs: when, tokens: usageTotals.tokens }].slice(
						-120,
					),
	};
};
