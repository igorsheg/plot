import { Schema } from "effect";

export class WorkflowFileNotFound extends Schema.TaggedErrorClass<WorkflowFileNotFound>()(
	"WorkflowFileNotFound",
	{ path: Schema.String },
) {}

export class WorkflowParseError extends Schema.TaggedErrorClass<WorkflowParseError>()(
	"WorkflowParseError",
	{ message: Schema.String },
) {}

export class TemplateRenderError extends Schema.TaggedErrorClass<TemplateRenderError>()(
	"TemplateRenderError",
	{ message: Schema.String },
) {}

export class WorkspaceError extends Schema.TaggedErrorClass<WorkspaceError>()("WorkspaceError", {
	code: Schema.String,
	message: Schema.String,
	path: Schema.optional(Schema.String),
}) {}

export class AgentRunnerError extends Schema.TaggedErrorClass<AgentRunnerError>()(
	"AgentRunnerError",
	{
		code: Schema.String,
		message: Schema.String,
	},
) {}

export class ConfigValidationError extends Schema.TaggedErrorClass<ConfigValidationError>()(
	"ConfigValidationError",
	{ message: Schema.String, field: Schema.optional(Schema.String) },
) {}
