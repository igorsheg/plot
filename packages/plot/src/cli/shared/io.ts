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

export function ensureTuiSupported(): void {
	if (process.stdout.isTTY && process.stdin.isTTY) return;
	throw new CliError("usage", "tui requires an interactive terminal; use serve", 2);
}

/**
 * Write a typed NDJSON line to stdout for bidirectional streaming protocols
 * (e.g., auth login flow where the desktop app reads/writes specific event types).
 */
export function writeNdjson(type: string, payload: object = {}) {
	process.stdout.write(`${JSON.stringify({ type, ...payload })}\n`);
}

/** Read one NDJSON line from stdin (for bidirectional protocols). */
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
