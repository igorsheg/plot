import { Schema } from "effect";
import { AgentRuntimeEvent } from "./events.js";
import { TrackerRunContext } from "./tracker.js";

export class ToolExecution extends Schema.Class<ToolExecution>("ToolExecution")(
	{
		toolCallId: Schema.String,
		toolName: Schema.String,
	},
) {}

export const AgentPhase = Schema.Literals(["idle", "thinking", "tool_execution", "compacting", "retrying"]);
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

export const PromptSectionKind = Schema.Literals(["system", "user"]);
export type PromptSectionKind = typeof PromptSectionKind.Type;

export class PromptSection extends Schema.Class<PromptSection>("PromptSection")(
	{
		id: Schema.String,
		title: Schema.String,
		kind: PromptSectionKind,
		content: Schema.String,
		charCount: Schema.Number,
	},
) {}

export class PromptSnapshot extends Schema.Class<PromptSnapshot>("PromptSnapshot",
)({
	system: Schema.String,
	user: Schema.String,
	stablePrefix: Schema.String,
	stablePrefixHash: Schema.String,
	systemCharCount: Schema.Number,
	userCharCount: Schema.Number,
	systemSections: Schema.Array(PromptSection),
	userSections: Schema.Array(PromptSection),
}) {}

export class TokenTotals extends Schema.Class<TokenTotals>("TokenTotals")({
	inputTokens: Schema.Number,
	outputTokens: Schema.Number,
	totalTokens: Schema.Number,
	secondsRunning: Schema.Number,
}) {}

export class RuntimeObservability extends Schema.Class<RuntimeObservability>("RuntimeObservability",
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

export const IssueStatus = Schema.Literals(["running", "retrying"]);
export type IssueStatus = typeof IssueStatus.Type;

export class RuntimeSnapshot extends Schema.Class<RuntimeSnapshot>("RuntimeSnapshot",
)({
	generatedAt: Schema.DateTimeUtcFromString,
	counts: Schema.Struct({
		running: Schema.Number,
		retrying: Schema.Number,
	}),
	running: Schema.Array(RunningEntry),
	retrying: Schema.Array(RetryEntry),
	codexTotals: TokenTotals,
	observability: RuntimeObservability,
	rateLimits: Schema.Null,
}) {}

export class IssueDetail extends Schema.Class<IssueDetail>("IssueDetail")({
	issueIdentifier: Schema.String,
	issueId: Schema.String,
	status: IssueStatus,
	workspacePath: Schema.NullOr(Schema.String),
	running: Schema.NullOr(RunningEntry),
	retry: Schema.NullOr(RetryEntry),
	lastError: Schema.NullOr(Schema.String),
	eventTail: Schema.Array(AgentRuntimeEvent),
	promptSnapshot: Schema.NullOr(PromptSnapshot),
	runContext: Schema.NullOr(TrackerRunContext),
}) {}

export class IssueEventLog extends Schema.Class<IssueEventLog>("IssueEventLog")(
	{
		issueId: Schema.String,
		issueIdentifier: Schema.String,
		events: Schema.Array(AgentRuntimeEvent),
	},
) {}
