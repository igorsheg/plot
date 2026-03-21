import { Schema } from "effect";
import { AgentRuntimeEvent } from "./events.js";

export class ToolExecution extends Schema.Class<ToolExecution>("ToolExecution")({
	toolCallId: Schema.String,
	toolName: Schema.String,
}) {}

export const AgentPhase = Schema.Literals([
	"idle",
	"thinking",
	"tool_execution",
	"compacting",
	"retrying",
]);
export type AgentPhase = typeof AgentPhase.Type;

export class LiveSession extends Schema.Class<LiveSession>("LiveSession")({
	sessionId: Schema.String,
	threadId: Schema.String,
	turnId: Schema.String,
	agentPid: Schema.NullOr(Schema.String),
	lastEvent: Schema.NullOr(Schema.String),
	lastEventAt: Schema.NullOr(Schema.DateTimeUtcFromString),
	lastMessage: Schema.NullOr(Schema.String),
	inputTokens: Schema.Number,
	outputTokens: Schema.Number,
	totalTokens: Schema.Number,
	turnCount: Schema.Number,
	phase: AgentPhase,
	activeTools: Schema.Array(ToolExecution),
	lastAssistantMessage: Schema.NullOr(Schema.String),
}) {}

export class RunningEntry extends Schema.Class<RunningEntry>("RunningEntry")({
	issueId: Schema.String,
	issueIdentifier: Schema.String,
	state: Schema.String,
	startedAt: Schema.DateTimeUtcFromString,
	workspacePath: Schema.NullOr(Schema.String),
	session: LiveSession,
}) {}

export class RetryEntry extends Schema.Class<RetryEntry>("RetryEntry")({
	issueId: Schema.String,
	identifier: Schema.String,
	attempt: Schema.Number,
	dueAt: Schema.DateTimeUtcFromString,
	error: Schema.NullOr(Schema.String),
}) {}


export class TokenTotals extends Schema.Class<TokenTotals>("TokenTotals")({
	inputTokens: Schema.Number,
	outputTokens: Schema.Number,
	totalTokens: Schema.Number,
	secondsRunning: Schema.Number,
}) {}

export class RuntimeObservability extends Schema.Class<RuntimeObservability>(
	"RuntimeObservability",
)({
	commandQueueDepth: Schema.Number,
	commandQueuePeak: Schema.Number,
	commandQueuePressureCount: Schema.Number,
	staleRetryDropCount: Schema.Number,
	retriesScheduledByReason: Schema.Struct({
		continuation: Schema.Number,
		failure: Schema.Number,
		backpressure: Schema.Number,
	}),
	workerStopsByReason: Schema.Struct({
		terminal: Schema.Number,
		inactive: Schema.Number,
		stalled: Schema.Number,
	}),
	workerExitsByReason: Schema.Struct({
		success: Schema.Number,
		interrupted: Schema.Number,
		failure: Schema.Number,
	}),
}) {}

export class RuntimeSnapshot extends Schema.Class<RuntimeSnapshot>("RuntimeSnapshot")({
	generatedAt: Schema.DateTimeUtcFromString,
	running: Schema.Array(RunningEntry),
	retrying: Schema.Array(RetryEntry),
	codexTotals: TokenTotals,
	observability: RuntimeObservability,
}) {}

export class IssueEventLog extends Schema.Class<IssueEventLog>("IssueEventLog")({
	issueId: Schema.String,
	issueIdentifier: Schema.String,
	events: Schema.Array(AgentRuntimeEvent),
}) {}

