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
		warn(message: string) {
			if (json || !verbose) return;
			process.stderr.write(`${message}\n`);
		},
		error(event: ErrorEvent) {
			if (json) {
				writeJson({ event: "error", ...event });
				return;
			}
			process.stderr.write(`error: ${event.message}\n`);
		},
		ready(event: ReadyEvent) {
			if (json) {
				writeJson({ event: "ready", ...event });
				return;
			}
			if (!verbose) return;
			const suffix = event.command === "serve" ? "listening on" : "available at";
			process.stderr.write(`plot-ai ${event.command} ${suffix} ${event.url}\n`);
		},
		shutdown(event: ShutdownEvent) {
			if (json) {
				writeJson({ event: "shutdown", ...event });
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

function writeJson(value: Record<string, unknown>) {
	process.stdout.write(`${JSON.stringify(value)}\n`);
}
