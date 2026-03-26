/** Parameter descriptor for a HATEOAS next_action template */
export interface ActionParam {
	description?: string;
	value?: string | number;
	default?: string | number;
	enum?: string[];
	required?: boolean;
}

/** A HATEOAS next action — command template the agent can run next */
export interface NextAction {
	command: string;
	description: string;
	params?: Record<string, ActionParam>;
}

/** Success envelope — ok: true */
export interface SuccessEnvelope<T = unknown> {
	ok: true;
	command: string;
	timestamp: number;
	result: T;
	next_actions: NextAction[];
}

/** Error detail inside the error envelope */
export interface EnvelopeError {
	message: string;
	code: string;
	retryable: boolean;
}

/** Error envelope — ok: false */
export interface ErrorEnvelope {
	ok: false;
	command: string;
	timestamp: number;
	error: EnvelopeError;
	fix: string;
	next_actions: NextAction[];
}

/** Union of both envelopes */
export type Envelope<T = unknown> = SuccessEnvelope<T> | ErrorEnvelope;

/** Stream event types for NDJSON streaming (ADR-0058) */
export type StreamEvent =
	| { type: "start"; command: string; ts: string }
	| {
			type: "step";
			name: string;
			status: "started" | "completed" | "failed";
			duration_ms?: number;
			error?: string;
			ts: string;
		}
	| { type: "progress"; name: string; percent?: number; message?: string; ts: string }
	| { type: "log"; level: "info" | "warn" | "error"; message: string; ts: string }
	| {
			type: "result";
			ok: true;
			command: string;
			timestamp: number;
			result: unknown;
			next_actions: NextAction[];
		}
	| {
			type: "error";
			ok: false;
			command: string;
			timestamp: number;
			error: EnvelopeError;
			fix: string;
			next_actions: NextAction[];
		};

/** Write a success envelope to stdout */
export function emitResult<T>(command: string, result: T, nextActions: NextAction[]): void {
	const envelope: SuccessEnvelope<T> = {
		ok: true,
		command,
		timestamp: Math.floor(Date.now() / 1000),
		result,
		next_actions: nextActions,
	};
	process.stdout.write(`${JSON.stringify(envelope)}\n`);
}

/** Write an error envelope to stdout */
export function emitError(
	command: string,
	error: EnvelopeError,
	fix: string,
	nextActions: NextAction[],
): void {
	const envelope: ErrorEnvelope = {
		ok: false,
		command,
		timestamp: Math.floor(Date.now() / 1000),
		error,
		fix,
		next_actions: nextActions,
	};
	process.stdout.write(`${JSON.stringify(envelope)}\n`);
}

/** Write a single NDJSON stream event to stdout */
export function emitStream(event: StreamEvent): void {
	process.stdout.write(`${JSON.stringify(event)}\n`);
}

/** Write a terminal success stream event (last line of a stream) */
export function emitStreamResult<T>(command: string, result: T, nextActions: NextAction[]): void {
	const event: StreamEvent & { type: "result" } = {
		type: "result",
		ok: true,
		command,
		timestamp: Math.floor(Date.now() / 1000),
		result,
		next_actions: nextActions,
	};
	process.stdout.write(`${JSON.stringify(event)}\n`);
}

/** Write a terminal error stream event (last line of a stream) */
export function emitStreamError(
	command: string,
	error: EnvelopeError,
	fix: string,
	nextActions: NextAction[],
): void {
	const event: StreamEvent & { type: "error" } = {
		type: "error",
		ok: false,
		command,
		timestamp: Math.floor(Date.now() / 1000),
		error,
		fix,
		next_actions: nextActions,
	};
	process.stdout.write(`${JSON.stringify(event)}\n`);
}

/** Write a diagnostic message to stderr (for --verbose output, not part of the JSON protocol) */
export function diagnostic(message: string, verbose: boolean): void {
	if (!verbose) return;
	process.stderr.write(`${message}\n`);
}
