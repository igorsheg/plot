import { spawn, type ChildProcess } from "node:child_process";
import {
	boundaryErrorFromRecord,
	PlotBoundaryError,
} from "@plot/common/boundary-error";
import { jsonlLines, parseJsonl } from "@plot/common/jsonl";
import {
	decodeSessionWorkerRecord,
	encodeSessionWorkerRecord,
	SessionWorkerProtocolError,
	workerMaxLineBytes,
	type SessionWorkerAction,
	type SessionWorkerCommand,
	type SessionWorkerReady,
	type SessionWorkerRecord,
} from "@plot/session/worker";
import { WorkflowBoundaryError } from "@plot/session/workflow";

export interface SessionChildExit {
	readonly code?: number | null;
	readonly signal?: NodeJS.Signals | null;
}

export interface SessionChildProcess {
	readonly pid?: number | undefined;
	readonly protocol: AsyncIterable<string | Uint8Array>;
	readonly stdout: AsyncIterable<string | Uint8Array>;
	readonly stderr: AsyncIterable<string | Uint8Array>;
	readonly write: (line: string) => Promise<void> | void;
	readonly kill: (signal: NodeJS.Signals) => void;
	readonly exited: Promise<SessionChildExit>;
}

export interface SessionProcessShutdownOptions {
	readonly gracefulMs: number;
	readonly terminateMs: number;
	readonly killMs: number;
}

export interface SessionProcessShutdownResult {
	readonly mode: "graceful" | "terminated" | "killed";
}

interface PendingCommand {
	readonly action: SessionWorkerAction;
	readonly resolve: (value: unknown) => void;
	readonly reject: (error: Error) => void;
	readonly timeout: ReturnType<typeof setTimeout>;
}

export class WorkerCommandTimeoutError extends PlotBoundaryError {
	override readonly name = "WorkerCommandTimeoutError";

	constructor(action: SessionWorkerAction, timeoutMs: number) {
		super({
			code: "worker_command_timeout",
			message: `Session worker command ${action} timed out after ${timeoutMs}ms`,
			retryable: true,
			context: { action, timeoutMs },
		});
	}
}

export class WorkerExitedError extends PlotBoundaryError {
	override readonly name = "WorkerExitedError";

	constructor(input: {
		readonly phase: "protocol" | "process" | "shutdown";
		readonly diagnostic?: string;
		readonly exit?: SessionChildExit;
		readonly message?: string;
	}) {
		const context: Record<string, string | number | boolean | null> = {
			phase: input.phase,
		};
		if (input.exit?.code !== undefined) context["code"] = input.exit.code;
		if (input.exit?.signal !== undefined) context["signal"] = input.exit.signal;
		const suffix = input.diagnostic ? ` Diagnostics: ${input.diagnostic}` : "";
		super({
			code: "worker_exited",
			message: `${input.message ?? "Session worker exited."}${suffix}`,
			retryable: true,
			context,
		});
	}
}

const asError = (error: unknown): Error =>
	error instanceof Error ? error : new Error(String(error));

const workerBoundaryError = (
	record: Parameters<typeof boundaryErrorFromRecord>[0],
): PlotBoundaryError => {
	if (
		record.code === "workflow_invalid" &&
		(record.context?.["phase"] === "read" ||
			record.context?.["phase"] === "parse" ||
			record.context?.["phase"] === "prepare")
	) {
		const input: {
			phase: "read" | "parse" | "prepare";
			message: string;
			path?: string;
		} = { phase: record.context["phase"], message: record.message };
		if (typeof record.context["path"] === "string")
			input.path = record.context["path"];
		return new WorkflowBoundaryError(input);
	}
	if (
		record.code === "worker_protocol_error" &&
		(record.context?.["phase"] === "command" ||
			record.context?.["phase"] === "record")
	)
		return new SessionWorkerProtocolError(
			record.message,
			record.context["phase"],
		);
	return boundaryErrorFromRecord(record);
};

export const trimDiagnostic = (value: string, maxBytes: number): string => {
	if (maxBytes <= 0) return "";
	const bytes = new TextEncoder().encode(value);
	if (bytes.length <= maxBytes) return value;
	let start = bytes.length - maxBytes;
	while (start < bytes.length && (bytes[start]! & 0xc0) === 0x80) start += 1;
	return new TextDecoder().decode(bytes.slice(start));
};

const safeDiagnostic = (value: string): string => {
	let result = "";
	for (const character of value) {
		const code = character.codePointAt(0) ?? 0;
		if (character === "\n" || character === "\r" || character === "\t")
			result += character;
		else if (code >= 32 && code !== 127) result += character;
	}
	return result;
};

export const createSessionChildProcess = (input: {
	readonly command: string;
	readonly args: readonly string[];
	readonly cwd: string;
}): SessionChildProcess => {
	const child: ChildProcess = spawn(input.command, [...input.args], {
		cwd: input.cwd,
		stdio: ["pipe", "pipe", "pipe", "pipe"],
	});
	const protocol = child.stdio[3];
	if (
		protocol === null ||
		protocol === undefined ||
		typeof protocol === "number" ||
		!(Symbol.asyncIterator in protocol)
	)
		throw new Error("Session worker protocol pipe was not created");
	const killOnParentExit = () => child.kill("SIGKILL");
	process.once("exit", killOnParentExit);
	child.once("exit", () => process.off("exit", killOnParentExit));
	child.once("error", () => process.off("exit", killOnParentExit));
	return {
		pid: child.pid,
		protocol,
		stdout: child.stdout!,
		stderr: child.stderr!,
		write: (line) =>
			new Promise<void>((resolve, reject) => {
				child.stdin!.write(line, (error) => {
					if (error == null) resolve();
					else reject(error);
				});
			}),
		kill: (signal) => {
			child.kill(signal);
		},
		exited: new Promise((resolve) => {
			child.once("exit", (code, signal) => resolve({ code, signal }));
			child.once("error", () => resolve({}));
		}),
	};
};

export class SessionProcess {
	readonly pid: number | undefined;
	private readonly pending = new Map<string, PendingCommand>();
	private readonly listeners = new Set<(record: SessionWorkerRecord) => void>();
	private readonly diagnosticListeners = new Set<(tail: string) => void>();
	private readonly exitListeners = new Set<(error: Error) => void>();
	private diagnostic = "";
	private failed = false;
	private didExit = false;
	private exit: SessionChildExit | undefined;
	private shutdownPromise: Promise<SessionProcessShutdownResult> | undefined;
	private readyRecord: SessionWorkerReady | undefined;
	private resolveReady!: (ready: SessionWorkerReady) => void;
	private rejectReady!: (error: Error) => void;
	private readonly ready = new Promise<SessionWorkerReady>(
		(resolve, reject) => {
			this.resolveReady = resolve;
			this.rejectReady = reject;
		},
	);

	constructor(
		private readonly child: SessionChildProcess,
		private readonly options: {
			readonly diagnosticLimitBytes: number;
			readonly commandTimeoutMs: number;
		},
	) {
		this.pid = child.pid;
		void this.consumeProtocol();
		void this.consumeDiagnostic(child.stdout, "stdout");
		void this.consumeDiagnostic(child.stderr, "stderr");
		void child.exited.then((exit) => {
			this.didExit = true;
			this.exit = exit;
			this.fail(
				new WorkerExitedError({
					phase: "process",
					diagnostic: this.diagnostic,
					exit,
				}),
			);
			return undefined;
		});
	}

	onRecord(listener: (record: SessionWorkerRecord) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	onDiagnostic(listener: (tail: string) => void): () => void {
		this.diagnosticListeners.add(listener);
		return () => this.diagnosticListeners.delete(listener);
	}

	onExit(listener: (error: Error) => void): () => void {
		this.exitListeners.add(listener);
		return () => this.exitListeners.delete(listener);
	}

	async waitUntilReady(ms: number): Promise<SessionWorkerReady> {
		if (this.readyRecord !== undefined) return this.readyRecord;
		let timeout: ReturnType<typeof setTimeout> | undefined;
		try {
			return await Promise.race([
				this.ready,
				new Promise<never>((_, reject) => {
					timeout = setTimeout(
						() => reject(new WorkerCommandTimeoutError("start", ms)),
						ms,
					);
				}),
			]);
		} finally {
			if (timeout !== undefined) clearTimeout(timeout);
		}
	}

	command(action: SessionWorkerAction, input?: unknown): Promise<unknown> {
		if (this.failed) {
			const failure: {
				phase: "process";
				diagnostic: string;
				message: string;
				exit?: SessionChildExit;
			} = {
				phase: "process",
				diagnostic: this.diagnostic,
				message: "Session worker is not running.",
			};
			if (this.exit !== undefined) failure.exit = this.exit;
			throw new WorkerExitedError(failure);
		}
		const id = `${action}-${crypto.randomUUID()}`;
		const command: SessionWorkerCommand = { kind: "command", id, action };
		const value = input === undefined ? command : { ...command, input };
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				if (!this.pending.delete(id)) return;
				reject(
					new WorkerCommandTimeoutError(action, this.options.commandTimeoutMs),
				);
			}, this.options.commandTimeoutMs);
			timeout.unref?.();
			this.pending.set(id, { action, resolve, reject, timeout });
			Promise.resolve(this.child.write(encodeSessionWorkerRecord(value))).catch(
				(error: unknown) => {
					clearTimeout(timeout);
					this.pending.delete(id);
					reject(asError(error));
				},
			);
		});
	}

	shutdown(
		options: SessionProcessShutdownOptions,
	): Promise<SessionProcessShutdownResult> {
		this.shutdownPromise ??= this.runShutdown(options);
		return this.shutdownPromise;
	}

	forceClose(): void {
		if (!this.didExit) this.child.kill("SIGKILL");
	}

	private async runShutdown(
		options: SessionProcessShutdownOptions,
	): Promise<SessionProcessShutdownResult> {
		if (this.didExit) return { mode: "graceful" };
		if (!this.failed) void this.command("shutdown").catch(() => undefined);
		if (await this.waitForExit(options.gracefulMs)) return { mode: "graceful" };
		this.child.kill("SIGTERM");
		if (await this.waitForExit(options.terminateMs))
			return { mode: "terminated" };
		this.child.kill("SIGKILL");
		if (await this.waitForExit(options.killMs)) return { mode: "killed" };
		throw new WorkerExitedError({
			phase: "shutdown",
			diagnostic: this.diagnostic,
			message: `Session worker did not exit after SIGKILL within ${options.killMs}ms.`,
		});
	}

	private async waitForExit(ms: number): Promise<boolean> {
		if (this.didExit) return true;
		let timeout: ReturnType<typeof setTimeout> | undefined;
		try {
			return await Promise.race([
				this.child.exited.then(() => true),
				new Promise<false>((resolve) => {
					timeout = setTimeout(() => resolve(false), ms);
					timeout.unref?.();
				}),
			]);
		} finally {
			if (timeout !== undefined) clearTimeout(timeout);
		}
	}

	private async consumeProtocol(): Promise<void> {
		try {
			for await (const line of jsonlLines(this.child.protocol, {
				maxLineBytes: workerMaxLineBytes,
			})) {
				if (line.trim() === "") continue;
				this.handleRecord(decodeSessionWorkerRecord(parseJsonl(line)));
			}
			if (!this.didExit)
				this.fail(
					new WorkerExitedError({
						phase: "protocol",
						diagnostic: this.diagnostic,
						message: "Session worker protocol closed.",
					}),
				);
		} catch (error) {
			this.fail(asError(error));
			this.child.kill("SIGTERM");
		}
	}

	private async consumeDiagnostic(
		stream: AsyncIterable<string | Uint8Array>,
		label: "stdout" | "stderr",
	): Promise<void> {
		const decoder = new TextDecoder();
		try {
			for await (const chunk of stream) {
				const text =
					typeof chunk === "string"
						? chunk
						: decoder.decode(chunk, { stream: true });
				this.appendDiagnostic(`[${label}] ${safeDiagnostic(text)}`);
			}
			const remaining = decoder.decode();
			if (remaining.length > 0)
				this.appendDiagnostic(`[${label}] ${safeDiagnostic(remaining)}`);
		} catch (error) {
			this.appendDiagnostic(
				`[${label}] diagnostic stream failed: ${asError(error).message}\n`,
			);
		}
	}

	private appendDiagnostic(text: string): void {
		this.diagnostic = trimDiagnostic(
			`${this.diagnostic}${text}`,
			this.options.diagnosticLimitBytes,
		);
		for (const listener of this.diagnosticListeners) listener(this.diagnostic);
	}

	private handleRecord(record: SessionWorkerRecord): void {
		if (record.kind === "failure") {
			this.fail(workerBoundaryError(record.error));
			return;
		}
		if (record.kind === "ready") {
			this.readyRecord = record;
			this.resolveReady(record);
		}
		if (record.kind === "result") {
			const pending = this.pending.get(record.id);
			if (pending !== undefined) {
				clearTimeout(pending.timeout);
				this.pending.delete(record.id);
				if (record.ok) pending.resolve(record.value);
				else pending.reject(workerBoundaryError(record.error));
			}
		}
		for (const listener of this.listeners) listener(record);
	}

	private fail(error: Error): void {
		if (this.failed) return;
		this.failed = true;
		if (this.readyRecord === undefined) this.rejectReady(error);
		for (const pending of this.pending.values()) {
			clearTimeout(pending.timeout);
			pending.reject(error);
		}
		this.pending.clear();
		for (const listener of this.exitListeners) listener(error);
	}
}
