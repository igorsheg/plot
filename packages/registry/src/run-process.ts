import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { jsonlLines, stringifyJsonl } from "@plot/common/jsonl";
import type { Mutable } from "@plot/common/primitives";
import { decodeServerRecordLine } from "@plot/session/protocol";
import {
	defaultProtocolLimits,
	type ClientRequest,
	type ServerRecord,
} from "@plot/session/protocol";

export interface RunChildProcess {
	readonly pid?: number;
	readonly stdout: AsyncIterable<string | Uint8Array>;
	readonly stderr: AsyncIterable<string | Uint8Array>;
	readonly write: (line: string) => Promise<void> | void;
	readonly kill: (signal?: NodeJS.Signals) => void;
	readonly exited: Promise<void>;
}

interface PendingRequest {
	readonly resolve: (record: ServerRecord) => void;
	readonly reject: (error: Error) => void;
}

async function* emptyAsyncIterable(): AsyncIterable<string | Uint8Array> {}

const toError = (error: unknown): Error =>
	error instanceof Error ? error : new Error(String(error));

export const trimTail = (value: string, maxBytes: number): string => {
	const bytes = new TextEncoder().encode(value);
	if (bytes.length <= maxBytes) return value;
	return new TextDecoder().decode(bytes.slice(bytes.length - maxBytes));
};

const decodeText = (decoder: TextDecoder, chunk: string | Uint8Array): string =>
	typeof chunk === "string" ? chunk : decoder.decode(chunk);

const encodeClientRequestLine = (request: ClientRequest): string =>
	stringifyJsonl(request, { maxLineBytes: 1024 * 1024 });

export const createRunChildProcess = (input: {
	readonly command: string;
	readonly args: readonly string[];
	readonly cwd: string;
}): RunChildProcess => {
	const child: ChildProcess = spawn(input.command, [...input.args], {
		cwd: input.cwd,
		stdio: ["pipe", "pipe", "pipe"],
	});
	const killOnParentExit = () => child.kill("SIGTERM");
	process.once("exit", killOnParentExit);
	child.once("exit", () => process.off("exit", killOnParentExit));
	child.once("error", () => process.off("exit", killOnParentExit));
	const runChild: Mutable<RunChildProcess> = {
		stdout: child.stdout ?? emptyAsyncIterable(),
		stderr: child.stderr ?? emptyAsyncIterable(),
		write: (line) =>
			new Promise<void>((resolveWrite, rejectWrite) => {
				child.stdin?.write(line, (error) => {
					if (error == null) resolveWrite();
					else rejectWrite(error);
				});
			}),
		kill: (signal) => {
			child.kill(signal);
		},
		exited: new Promise((resolveExit) => {
			child.once("exit", () => resolveExit());
			child.once("error", () => resolveExit());
		}),
	};
	if (child.pid !== undefined) runChild.pid = child.pid;
	return runChild;
};

export class RunProcessInstance {
	readonly pid: number | undefined;
	private readonly pending = new Map<string, PendingRequest>();
	private readonly recordListeners = new Set<(record: ServerRecord) => void>();
	private readonly stderrListeners = new Set<(tail: string) => void>();
	private readonly exitListeners = new Set<(error?: Error) => void>();
	private stderrTail = "";
	private exited = false;
	private welcome: ServerRecord | undefined;
	private resolveWelcome!: (record: ServerRecord) => void;
	private rejectWelcome!: (error: Error) => void;
	private readonly welcomePromise = new Promise<ServerRecord>(
		(resolve, reject) => {
			this.resolveWelcome = resolve;
			this.rejectWelcome = reject;
		},
	);

	constructor(
		private readonly child: RunChildProcess,
		private readonly options: {
			readonly stderrLimitBytes: number;
			readonly maxLineBytes?: number;
		},
	) {
		this.pid = child.pid;
		void this.consumeStdout();
		void this.consumeStderr();
		void child.exited.then(() => this.handleExit());
	}

	onRecord(listener: (record: ServerRecord) => void): () => void {
		this.recordListeners.add(listener);
		return () => this.recordListeners.delete(listener);
	}

	onStderrTail(listener: (tail: string) => void): () => void {
		this.stderrListeners.add(listener);
		return () => this.stderrListeners.delete(listener);
	}

	onExit(listener: (error?: Error) => void): () => void {
		this.exitListeners.add(listener);
		return () => this.exitListeners.delete(listener);
	}

	async waitForWelcome(ms: number): Promise<void> {
		if (this.welcome !== undefined) return;
		let timeout: ReturnType<typeof setTimeout> | undefined;
		try {
			await Promise.race([
				this.welcomePromise,
				new Promise<never>((_, reject) => {
					timeout = setTimeout(
						() => reject(new Error("run did not send welcome")),
						ms,
					);
				}),
			]);
		} finally {
			if (timeout !== undefined) clearTimeout(timeout);
		}
	}

	send(request: ClientRequest): Promise<ServerRecord> {
		if (this.exited)
			throw new Error(`run process is not running. Stderr: ${this.stderrTail}`);
		const id = request.id || `run_process_${randomUUID()}`;
		const fullRequest = { ...request, id };
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
			Promise.resolve(
				this.child.write(encodeClientRequestLine(fullRequest)),
			).catch((error: unknown) => {
				this.pending.delete(id);
				reject(toError(error));
			});
		});
	}

	kill(signal?: NodeJS.Signals): void {
		this.child.kill(signal);
	}

	private async consumeStdout(): Promise<void> {
		try {
			for await (const line of jsonlLines(this.child.stdout, {
				maxLineBytes:
					this.options.maxLineBytes ?? defaultProtocolLimits.maxInputLineBytes,
			})) {
				const trimmed = line.trim();
				if (trimmed === "") continue;
				this.handleRecord(decodeServerRecordLine(trimmed));
			}
			if (this.welcome === undefined)
				this.rejectWelcome(new Error("run closed before welcome"));
		} catch (error) {
			this.fail(toError(error));
		}
	}

	private async consumeStderr(): Promise<void> {
		const decoder = new TextDecoder();
		try {
			for await (const chunk of this.child.stderr) {
				this.stderrTail = trimTail(
					`${this.stderrTail}${decodeText(decoder, chunk)}`,
					this.options.stderrLimitBytes,
				);
				for (const listener of this.stderrListeners) listener(this.stderrTail);
			}
		} catch (error) {
			this.fail(toError(error));
		}
	}

	private handleRecord(record: ServerRecord): void {
		if (record.kind === "welcome") {
			this.welcome = record;
			this.resolveWelcome(record);
		}
		if (record.kind === "response" && typeof record.id === "string") {
			this.pending.get(record.id)?.resolve(record);
			this.pending.delete(record.id);
		}
		for (const listener of this.recordListeners) listener(record);
	}

	private handleExit(): void {
		if (this.exited) return;
		this.exited = true;
		const error = new Error(`run process exited. Stderr: ${this.stderrTail}`);
		if (this.welcome === undefined) this.rejectWelcome(error);
		for (const pending of this.pending.values()) pending.reject(error);
		this.pending.clear();
		for (const listener of this.exitListeners) listener(error);
	}

	private fail(error: Error): void {
		if (this.exited) return;
		this.exited = true;
		if (this.welcome === undefined) this.rejectWelcome(error);
		for (const pending of this.pending.values()) pending.reject(error);
		this.pending.clear();
		for (const listener of this.exitListeners) listener(error);
	}
}
