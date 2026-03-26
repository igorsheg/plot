import { Schema } from "effect";

export class WorkspaceError extends Schema.TaggedErrorClass<WorkspaceError>()("WorkspaceError", {
	code: Schema.String,
	message: Schema.String,
	path: Schema.optional(Schema.String),
	cause: Schema.optional(Schema.Defect),
}) {
	override get message(): string {
		return `Workspace error [${this.code}]: ${this.message}${this.path ? ` (${this.path})` : ""}`;
	}
}

export class WorkflowFileNotFound extends Schema.TaggedErrorClass<WorkflowFileNotFound>()(
	"WorkflowFileNotFound",
	{ path: Schema.String, cause: Schema.optional(Schema.Defect) },
) {
	override get message(): string {
		return `Workflow file not found: ${this.path}`;
	}
}

export class WorkflowParseError extends Schema.TaggedErrorClass<WorkflowParseError>()(
	"WorkflowParseError",
	{ message: Schema.String, cause: Schema.optional(Schema.Defect) },
) {
	override get message(): string {
		return `Workflow parse error: ${this.message}`;
	}
}

export class ConfigValidationError extends Schema.TaggedErrorClass<ConfigValidationError>()(
	"ConfigValidationError",
	{ message: Schema.String, field: Schema.optional(Schema.String), cause: Schema.optional(Schema.Defect) },
) {
	override get message(): string {
		return `Config validation failed${this.field ? ` at ${this.field}` : ""}: ${this.message}`;
	}
}

export class TemplateRenderError extends Schema.TaggedErrorClass<TemplateRenderError>()(
	"TemplateRenderError",
	{
		message: Schema.String,
		cause: Schema.optional(Schema.Defect),
	},
) {
	override get message(): string {
		return `Template render error: ${this.message}`;
	}
}
