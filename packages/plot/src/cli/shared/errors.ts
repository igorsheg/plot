import type { EnvelopeError } from "./envelope.js";

/** Known CLI error codes */
export type ErrorCode =
	| "SERVER_UNREACHABLE"
	| "AUTH_REQUIRED"
	| "AUTH_EXPIRED"
	| "WORKFLOW_NOT_FOUND"
	| "WORKFLOW_PARSE_ERROR"
	| "PORT_IN_USE"
	| "PROVIDER_UNKNOWN"
	| "SPAWN_FAILED"
	| "TRACKER_PLUGIN_ERROR";

interface ErrorDef {
	retryable: boolean;
	fix: (ctx?: Record<string, string>) => string;
}

const registry: Record<ErrorCode, ErrorDef> = {
	SERVER_UNREACHABLE: {
		retryable: true,
		fix: (ctx) => {
			const port = ctx?.["port"] ?? "3000";
			return `check that the server is running on port ${port}, or start it with: plot-ai --mode rpc`;
		},
	},
	AUTH_REQUIRED: {
		retryable: false,
		fix: (ctx) => {
			const provider = ctx?.["provider"] ?? "<provider>";
			return `run: plot-ai auth login ${provider}`;
		},
	},
	AUTH_EXPIRED: {
		retryable: true,
		fix: (ctx) => {
			const provider = ctx?.["provider"] ?? "<provider>";
			return `token expired, re-authenticate: plot-ai auth login ${provider}`;
		},
	},
	WORKFLOW_NOT_FOUND: {
		retryable: false,
		fix: (ctx) => {
			const path = ctx?.["path"] ?? "WORKFLOW.md";
			return `create ${path} or specify a different path with --workflow`;
		},
	},
	WORKFLOW_PARSE_ERROR: {
		retryable: false,
		fix: (ctx) => {
			const path = ctx?.["path"] ?? "WORKFLOW.md";
			return `check YAML frontmatter syntax in ${path}`;
		},
	},
	PORT_IN_USE: {
		retryable: false,
		fix: (ctx) => {
			const port = ctx?.["port"] ?? "3000";
			return `port ${port} is in use — try a different port with --port or stop the existing process`;
		},
	},
	PROVIDER_UNKNOWN: {
		retryable: false,
		fix: (ctx) => {
			const provider = ctx?.["provider"] ?? "<provider>";
			return `unknown provider "${provider}" — run: plot-ai models`;
		},
	},
	SPAWN_FAILED: {
		retryable: true,
		fix: (ctx) => {
			const binary = ctx?.["binary"] ?? "plot-ai";
			return `child process failed to start — check that ${binary} is installed and on PATH`;
		},
	},
	TRACKER_PLUGIN_ERROR: {
		retryable: true,
		fix: () => "tracker plugin failed — retry with --refresh-plugins to re-fetch",
	},
};

/** Look up an error code and build an EnvelopeError with fix string */
export function lookupError(
	code: ErrorCode,
	message: string,
	ctx?: Record<string, string>,
): { error: EnvelopeError; fix: string } {
	const def = registry[code];
	return {
		error: {
			message,
			code,
			retryable: def.retryable,
		},
		fix: def.fix(ctx),
	};
}
