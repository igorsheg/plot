export type CliErrorKind = "usage" | "startup" | "runtime";

export class CliError extends Error {
	readonly kind: CliErrorKind;
	readonly exitCode: number;

	constructor(kind: CliErrorKind, message: string, exitCode: number) {
		super(message);
		this.kind = kind;
		this.exitCode = exitCode;
	}
}

export interface CliOutputOptions {
	json?: boolean;
	verbose?: boolean;
}

interface ErrorEvent {
	kind: CliErrorKind;
	message: string;
	exitCode: number;
}

interface ReadyEvent {
	command: string;
	url: string;
	pid?: number;
}

interface ShutdownEvent {
	command: string;
	signal: NodeJS.Signals;
}

export function resolveRequestedOutputMode(argv: string[]): CliOutputOptions {
	return {
		json: argv.includes("--json"),
		verbose: argv.includes("--verbose"),
	};
}

export function createCliOutput(options: CliOutputOptions) {
	const json = options.json ?? false;
	const verbose = options.verbose ?? false;

	return {
		json,
		verbose,
		info(message: string) {
			if (json || !verbose) return;
			process.stderr.write(`${message}\n`);
		},
		error(event: ErrorEvent) {
			if (json) {
				writeNdjson("error", event);
				return;
			}
			process.stderr.write(`error: ${event.message}\n`);
		},
		ready(event: ReadyEvent) {
			if (json) {
				writeNdjson("serve:ready", event);
				return;
			}
			if (!verbose) return;
			const suffix = event.command === "serve" ? "listening on" : "available at";
			process.stderr.write(`plot-ai ${event.command} ${suffix} ${event.url}\n`);
		},
		shutdown(event: ShutdownEvent) {
			if (json) {
				writeNdjson("serve:shutdown", event);
				return;
			}
			if (!verbose) return;
			process.stderr.write(`plot-ai ${event.command} stopped (${event.signal})\n`);
		},
	};
}

export function ensureJsonSupported(json: boolean | undefined, command: string): void {
	if (!json) return;
	throw new CliError(
		"usage",
		`${command} does not support --json; use serve for machine-readable output`,
		2,
	);
}

export function ensureTuiSupported(): void {
	if (process.stdout.isTTY && process.stdin.isTTY) return;
	throw new CliError("usage", "tui requires an interactive terminal; use serve", 2);
}

/**
 * Write a typed NDJSON line to stdout.
 * All --json output across every command MUST use this.
 * Convention: type is "namespace:action" (e.g., "auth:prompt", "serve:ready")
 * except "error" which is global.
 */
export function writeNdjson(type: string, payload: object = {}) {
	process.stdout.write(`${JSON.stringify({ type, ...payload })}\n`);
}

/**
 * Read one NDJSON line from stdin (for bidirectional --json protocols).
 * Resolves when a complete line is received.
 */
export function readNdjson(): Promise<{ type: string; [key: string]: unknown }> {
	return new Promise((resolve, reject) => {
		let buffer = "";
		const onData = (chunk: Buffer) => {
			buffer += chunk.toString();
			const newlineIndex = buffer.indexOf("\n");
			if (newlineIndex !== -1) {
				const line = buffer.slice(0, newlineIndex);
				process.stdin.removeListener("data", onData);
				process.stdin.pause();
				try {
					resolve(JSON.parse(line));
				} catch {
					reject(new CliError("runtime", `invalid JSON from client: ${line}`, 1));
				}
			}
		};
		process.stdin.resume();
		process.stdin.on("data", onData);
	});
}
