import { Schema } from "effect";

export class IssueNotFound extends Schema.TaggedErrorClass<IssueNotFound>()(
	"IssueNotFound",
	{
		identifier: Schema.String,
		message: Schema.String,
	},
) {}

export class OrchestratorUnavailable extends Schema.TaggedErrorClass<OrchestratorUnavailable>()(
	"OrchestratorUnavailable",
	{
		message: Schema.String,
	},
) {}

export class TrackerAuthError extends Schema.TaggedErrorClass<TrackerAuthError>()(
	"TrackerAuthError",
	{ message: Schema.String },
) {}

export class TrackerRateLimitError extends Schema.TaggedErrorClass<TrackerRateLimitError>()(
	"TrackerRateLimitError",
	{
		message: Schema.String,
		retryAfterMs: Schema.optional(Schema.Number),
	},
) {}

export class TrackerNotFoundError extends Schema.TaggedErrorClass<TrackerNotFoundError>()(
	"TrackerNotFoundError",
	{
		message: Schema.String,
		resourceId: Schema.String,
	},
) {}

export class TrackerNetworkError extends Schema.TaggedErrorClass<TrackerNetworkError>()(
	"TrackerNetworkError",
	{ message: Schema.String },
) {}

export class TrackerValidationError extends Schema.TaggedErrorClass<TrackerValidationError>()(
	"TrackerValidationError",
	{
		message: Schema.String,
		field: Schema.optional(Schema.String),
	},
) {}

export type TrackerError =
	| TrackerAuthError
	| TrackerRateLimitError
	| TrackerNotFoundError
	| TrackerNetworkError
	| TrackerValidationError;

export const PlotApiError = Schema.Union([IssueNotFound, OrchestratorUnavailable]);
export type PlotApiError = typeof PlotApiError.Type;
