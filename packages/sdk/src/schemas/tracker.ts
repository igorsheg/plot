import { Effect, Schema, ServiceMap } from "effect";
import type { Issue, IssueStateEntry } from "./issue.js";
import type { TrackerError } from "../errors.js";

export class WorkpadSection extends Schema.Class<WorkpadSection>("WorkpadSection",
)({
	title: Schema.String,
	body: Schema.String,
	itemCount: Schema.Number,
}) {}

export class TrackerRunContext extends Schema.Class<TrackerRunContext>("TrackerRunContext",
)({
	raw: Schema.NullOr(Schema.String),
	promptContext: Schema.NullOr(Schema.String),
	workpad: Schema.NullOr(Schema.String),
	reviewFeedback: Schema.NullOr(Schema.String),
	workpadSections: Schema.Array(WorkpadSection),
}) {}


export class AgentPreset extends Schema.Class<AgentPreset>("AgentPreset")({
	id: Schema.String,
	labels: Schema.Array(Schema.String),
	model: Schema.optional(Schema.String),
	commandPrefix: Schema.optional(Schema.Array(Schema.String)),
	extraArgs: Schema.optional(Schema.Array(Schema.String)),
	metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}) {}

export class UpdateIssueOptions extends Schema.Class<UpdateIssueOptions>("UpdateIssueOptions")({
	issueId: Schema.String,
	title: Schema.optional(Schema.String),
	description: Schema.optional(Schema.String),
	state: Schema.optional(Schema.String),
	blockedBy: Schema.optional(Schema.Array(Schema.String)),
	autoMerge: Schema.optional(Schema.Boolean),
}) {}

export interface TrackerClientShape {
	readonly fetchCandidateIssues: (
		dispatchStates: ReadonlyArray<string>,
	) => Effect.Effect<ReadonlyArray<Issue>, TrackerError>;

	readonly fetchIssuesByStates: (
		states: ReadonlyArray<string>,
	) => Effect.Effect<ReadonlyArray<Issue>, TrackerError>;

	readonly fetchIssueStatesByIds: (
		ids: ReadonlyArray<string>,
	) => Effect.Effect<ReadonlyArray<IssueStateEntry>, TrackerError>;

	readonly fetchRunContext: (
		issueId: string,
		state: string,
	) => Effect.Effect<TrackerRunContext | null, TrackerError>;

	readonly updateIssue?: (
		options: UpdateIssueOptions,
	) => Effect.Effect<void, TrackerError>;

	readonly cancelIssue?: (
		issueId: string,
	) => Effect.Effect<void, TrackerError>;

	readonly ensureInProgress?: (
		issueId: string,
	) => Effect.Effect<void, TrackerError>;

	readonly issueAgentPreset?: (
		issue: Issue,
	) => Effect.Effect<AgentPreset | null, TrackerError>;

	readonly updateAgentPreset?: (
		preset: AgentPreset,
	) => Effect.Effect<AgentPreset, TrackerError>;

	readonly agentPresetInfo?: (
		preset: AgentPreset,
	) => Effect.Effect<void, TrackerError>;

	readonly reset?: () => Effect.Effect<void, TrackerError>;

	readonly settings?: (
		projectId: string,
	) => Effect.Effect<void, TrackerError>;
}

export class TrackerClient extends ServiceMap.Service<TrackerClient, TrackerClientShape>()("TrackerClient") {}

export interface TrackerPluginConfig {
	readonly kind: string;
	readonly endpoint?: string;
	readonly apiKey?: string;
	readonly projectSlug?: string;
	readonly dispatchStates?: ReadonlyArray<string>;
	readonly parkedStates?: ReadonlyArray<string>;
	readonly terminalStates?: ReadonlyArray<string>;
	readonly [key: string]: unknown;
}
