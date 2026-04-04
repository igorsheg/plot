export class IssueNotFound extends Error {
	readonly _tag = "IssueNotFound" as const;
	readonly identifier: string;
	constructor(opts: { identifier: string; message: string }) {
		super(`Issue not found: ${opts.identifier} — ${opts.message}`);
		this.name = "IssueNotFound";
		this.identifier = opts.identifier;
	}
}

export class OrchestratorUnavailable extends Error {
	readonly _tag = "OrchestratorUnavailable" as const;
	constructor(opts: { message: string }) {
		super(`Orchestrator unavailable: ${opts.message}`);
		this.name = "OrchestratorUnavailable";
	}
}

export class TrackerAuthError extends Error {
	readonly _tag = "TrackerAuthError" as const;
	constructor(opts: { message: string }) {
		super(`Tracker auth error: ${opts.message}`);
		this.name = "TrackerAuthError";
	}
}

export class TrackerRateLimitError extends Error {
	readonly _tag = "TrackerRateLimitError" as const;
	readonly retryAfterMs?: number;
	constructor(opts: { message: string; retryAfterMs?: number }) {
		super(`Tracker rate limited: ${opts.message}${opts.retryAfterMs !== undefined ? ` (retry after ${opts.retryAfterMs}ms)` : ""}`);
		this.name = "TrackerRateLimitError";
		this.retryAfterMs = opts.retryAfterMs;
	}
}

export class TrackerNotFoundError extends Error {
	readonly _tag = "TrackerNotFoundError" as const;
	readonly resourceId: string;
	constructor(opts: { message: string; resourceId: string }) {
		super(`Tracker resource not found: ${opts.resourceId} — ${opts.message}`);
		this.name = "TrackerNotFoundError";
		this.resourceId = opts.resourceId;
	}
}

export class TrackerNetworkError extends Error {
	readonly _tag = "TrackerNetworkError" as const;
	constructor(opts: { message: string }) {
		super(`Tracker network error: ${opts.message}`);
		this.name = "TrackerNetworkError";
	}
}

export class TrackerValidationError extends Error {
	readonly _tag = "TrackerValidationError" as const;
	readonly field?: string;
	constructor(opts: { message: string; field?: string }) {
		super(`Tracker validation error${opts.field ? ` at ${opts.field}` : ""}: ${opts.message}`);
		this.name = "TrackerValidationError";
		this.field = opts.field;
	}
}

export type TrackerError =
	| TrackerAuthError
	| TrackerRateLimitError
	| TrackerNotFoundError
	| TrackerNetworkError
	| TrackerValidationError;

export type PlotApiError = IssueNotFound | OrchestratorUnavailable;
