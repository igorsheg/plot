export class PluginAuthError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PluginAuthError";
	}
}

export class PluginRateLimitError extends Error {
	readonly retryAfterMs?: number;
	constructor(message: string, retryAfterMs?: number) {
		super(message);
		this.name = "PluginRateLimitError";
		this.retryAfterMs = retryAfterMs;
	}
}

export class PluginNotFoundError extends Error {
	readonly resourceId: string;
	constructor(message: string, resourceId: string) {
		super(message);
		this.name = "PluginNotFoundError";
		this.resourceId = resourceId;
	}
}

export class PluginValidationError extends Error {
	readonly field?: string;
	constructor(message: string, field?: string) {
		super(message);
		this.name = "PluginValidationError";
		this.field = field;
	}
}
