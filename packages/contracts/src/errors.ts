import { Schema } from "effect";

export class WorkflowFileNotFound extends Schema.TaggedError<WorkflowFileNotFound>()(
	"WorkflowFileNotFound",
	{ path: Schema.String },
) {}

export class WorkflowParseError extends Schema.TaggedError<WorkflowParseError>()(
	"WorkflowParseError",
	{ message: Schema.String },
) {}

export class TemplateRenderError extends Schema.TaggedError<TemplateRenderError>()(
	"TemplateRenderError",
	{ message: Schema.String },
) {}

export class TrackerError extends Schema.TaggedError<TrackerError>()(
	"TrackerError",
	{
		code: Schema.String,
		message: Schema.String,
	},
) {}

export class WorkspaceError extends Schema.TaggedError<WorkspaceError>()(
	"WorkspaceError",
	{
		code: Schema.String,
		message: Schema.String,
		path: Schema.optional(Schema.String),
	},
) {}

export class AgentRunnerError extends Schema.TaggedError<AgentRunnerError>()(
	"AgentRunnerError",
	{
		code: Schema.String,
		message: Schema.String,
	},
) {}

export class ConfigValidationError extends Schema.TaggedError<ConfigValidationError>()(
	"ConfigValidationError",
	{ message: Schema.String, field: Schema.optional(Schema.String) },
) {}

export class IssueNotFound extends Schema.TaggedError<IssueNotFound>()(
	"IssueNotFound",
	{
		identifier: Schema.String,
		message: Schema.String,
	},
) {}

export class OrchestratorUnavailable extends Schema.TaggedError<OrchestratorUnavailable>()(
	"OrchestratorUnavailable",
	{
		message: Schema.String,
	},
) {}

export const PlotApiError = Schema.Union(
	IssueNotFound,
	OrchestratorUnavailable,
);
export type PlotApiError = typeof PlotApiError.Type;
