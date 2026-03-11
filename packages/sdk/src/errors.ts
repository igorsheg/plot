import { Schema } from "effect";

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

export class TrackerAuthError extends Schema.TaggedError<TrackerAuthError>()(
	"TrackerAuthError",
	{ message: Schema.String },
) {}

export class TrackerRateLimitError extends Schema.TaggedError<TrackerRateLimitError>()(
	"TrackerRateLimitError",
	{
		message: Schema.String,
		retryAfterMs: Schema.optional(Schema.Number),
	},
) {}

export class TrackerNotFoundError extends Schema.TaggedError<TrackerNotFoundError>()(
	"TrackerNotFoundError",
	{
		message: Schema.String,
		resourceId: Schema.String,
	},
) {}

export class TrackerNetworkError extends Schema.TaggedError<TrackerNetworkError>()(
	"TrackerNetworkError",
	{ message: Schema.String },
) {}

export class TrackerValidationError extends Schema.TaggedError<TrackerValidationError>()(
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

export const PlotApiError = Schema.Union(
	IssueNotFound,
	OrchestratorUnavailable,
);
export type PlotApiError = typeof PlotApiError.Type;
