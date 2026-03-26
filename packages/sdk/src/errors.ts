import { Schema } from "effect";

export class IssueNotFound extends Schema.TaggedErrorClass<IssueNotFound>()("IssueNotFound", {
	identifier: Schema.String,
	message: Schema.String,
	cause: Schema.optional(Schema.Defect),
}) {
	override get message(): string {
		return `Issue not found: ${this.identifier} — ${this.message}`;
	}
}

export class OrchestratorUnavailable extends Schema.TaggedErrorClass<OrchestratorUnavailable>()(
	"OrchestratorUnavailable",
	{
		message: Schema.String,
		cause: Schema.optional(Schema.Defect),
	},
) {
	override get message(): string {
		return `Orchestrator unavailable: ${this.message}`;
	}
}

export class TrackerAuthError extends Schema.TaggedErrorClass<TrackerAuthError>()(
	"TrackerAuthError",
	{
		message: Schema.String,
		cause: Schema.optional(Schema.Defect),
	},
) {
	override get message(): string {
		return `Tracker auth error: ${this.message}`;
	}
}

export class TrackerRateLimitError extends Schema.TaggedErrorClass<TrackerRateLimitError>()(
	"TrackerRateLimitError",
	{
		message: Schema.String,
		retryAfterMs: Schema.optional(Schema.Number),
		cause: Schema.optional(Schema.Defect),
	},
) {
	override get message(): string {
		return `Tracker rate limited: ${this.message}${this.retryAfterMs !== undefined ? ` (retry after ${this.retryAfterMs}ms)` : ""}`;
	}
}

export class TrackerNotFoundError extends Schema.TaggedErrorClass<TrackerNotFoundError>()(
	"TrackerNotFoundError",
	{
		message: Schema.String,
		resourceId: Schema.String,
		cause: Schema.optional(Schema.Defect),
	},
) {
	override get message(): string {
		return `Tracker resource not found: ${this.resourceId} — ${this.message}`;
	}
}

export class TrackerNetworkError extends Schema.TaggedErrorClass<TrackerNetworkError>()(
	"TrackerNetworkError",
	{
		message: Schema.String,
		cause: Schema.optional(Schema.Defect),
	},
) {
	override get message(): string {
		return `Tracker network error: ${this.message}`;
	}
}

export class TrackerValidationError extends Schema.TaggedErrorClass<TrackerValidationError>()(
	"TrackerValidationError",
	{
		message: Schema.String,
		field: Schema.optional(Schema.String),
		cause: Schema.optional(Schema.Defect),
	},
) {
	override get message(): string {
		return `Tracker validation error${this.field ? ` at ${this.field}` : ""}: ${this.message}`;
	}
}

export type TrackerError =
	| TrackerAuthError
	| TrackerRateLimitError
	| TrackerNotFoundError
	| TrackerNetworkError
	| TrackerValidationError;

export const PlotApiError = Schema.Union([IssueNotFound, OrchestratorUnavailable]);
export type PlotApiError = typeof PlotApiError.Type;
