import {
	boundaryErrorFromRecord,
	BoundaryError,
} from "@plot/common/boundary-error";
import type {
	OperatorObservationInput,
	SourceActionInput,
} from "@plot/session/runtime";
import {
	decodeSessionWorkerRecord,
	SessionWorkerProtocolError,
	type SessionWorkerAction,
	type SessionWorkerCommand,
	type SessionWorkerReady,
	type SessionWorkerRecord,
} from "@plot/session/worker";
import { workflowBoundaryErrorFromRecord } from "@plot/session/workflow";

const PENDING_COMMAND_CAPACITY = 64;

export interface ProcessCommand {
	readonly command: string;
	readonly args: readonly string[];
}

export interface SessionChildExit {
	readonly code?: number | null;
	readonly signal?: NodeJS.Signals | null;
}

export interface SessionChildProcess {
	readonly stdout: AsyncIterable<string | Uint8Array>;
	readonly stderr: AsyncIterable<string | Uint8Array>;
	readonly send: (command: SessionWorkerCommand) => void;
	readonly onMessage: (listener: (message: unknown) => void) => () => void;
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
	readonly resolve: (value: unknown) => void;
	readonly reject: (error: Error) => void;
	readonly timeout: ReturnType<typeof setTimeout>;
}

type ProcessState =
	| {
			readonly state: "waiting";
			readonly ready: PromiseWithResolvers<SessionWorkerReady>;
	  }
	| {
			readonly state: "online";
			readonly ready: SessionWorkerReady;
			readonly pending: Map<string, PendingCommand>;
	  }
	| {
			readonly state: "shutting_down";
			readonly pending: Map<string, PendingCommand>;
			operation: Promise<SessionProcessShutdownResult>;
	  }
	| {
			readonly state: "exited";
			readonly error: Error;
			readonly exit?: SessionChildExit;
	  };

export class WorkerCommandTimeoutError extends BoundaryError {
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

export class WorkerExitedError extends BoundaryError {
	override readonly name = "WorkerExitedError";

	constructor(input: {
		readonly phase: "process" | "shutdown";
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
): BoundaryError => {
	const workflow = workflowBoundaryErrorFromRecord(record);
	if (workflow !== undefined) return workflow;
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

export const createSessionChildProcess = (
	input: ProcessCommand & { readonly cwd: string },
): SessionChildProcess => {
	let listener: ((message: unknown) => void) | undefined;
	const earlyMessages: unknown[] = [];
	const child = Bun.spawn([input.command, ...input.args], {
		cwd: input.cwd,
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
		serialization: "json",
		ipc: (message) => {
			if (listener === undefined) earlyMessages.push(message);
			else listener(message);
		},
	});
	const killOnParentExit = () => child.kill("SIGKILL");
	process.once("exit", killOnParentExit);
	const exited = child.exited.then((code) => {
		process.off("exit", killOnParentExit);
		const signal = child.signalCode as NodeJS.Signals | null;
		return { code, signal };
	});
	return {
		stdout: child.stdout,
		stderr: child.stderr,
		send: (command) => child.send(command),
		onMessage: (receive) => {
			listener = receive;
			const queued = earlyMessages.splice(0);
			queueMicrotask(() => queued.forEach(receive));
			return () => {
				listener = undefined;
			};
		},
		kill: (signal) => child.kill(signal),
		exited,
	};
};

const workerCommand = (
	action: SessionWorkerAction,
	id: string,
	input?: unknown,
): SessionWorkerCommand => {
	if (action === "start" || action === "shutdown" || action === "tick")
		return { kind: "command", id, action };
	if (action === "source-action-cancel")
		return { kind: "command", id, action, input: input as string };
	if (action === "observe")
		return {
			kind: "command",
			id,
			action,
			input: input as OperatorObservationInput,
		};
	return {
		kind: "command",
		id,
		action,
		input: input as SourceActionInput,
	};
};

export class SessionProcess {
	private readonly listeners = new Set<(record: SessionWorkerRecord) => void>();
	private readonly exitListeners = new Set<(error: Error) => void>();
	private diagnostic = "";
	private stopMessages = () => {};
	private state: ProcessState = {
		state: "waiting",
		ready: Promise.withResolvers<SessionWorkerReady>(),
	};

	constructor(
		private readonly child: SessionChildProcess,
		private readonly options: {
			readonly diagnosticLimitBytes: number;
			readonly commandTimeoutMs: number;
		},
	) {
		this.stopMessages = child.onMessage((message) => this.receive(message));
		void this.consumeDiagnostic(child.stdout, "stdout");
		void this.consumeDiagnostic(child.stderr, "stderr");
		void child.exited.then((exit) => {
			this.transitionToExited(
				new WorkerExitedError({
					phase: "process",
					diagnostic: this.diagnostic,
					exit,
				}),
				exit,
			);
			return undefined;
		});
	}

	onRecord(listener: (record: SessionWorkerRecord) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	diagnosticTail(): string {
		return this.diagnostic;
	}

	onExit(listener: (error: Error) => void): () => void {
		this.exitListeners.add(listener);
		return () => this.exitListeners.delete(listener);
	}

	async waitUntilReady(ms: number): Promise<SessionWorkerReady> {
		if (this.state.state === "online") return this.state.ready;
		if (this.state.state !== "waiting") throw this.notRunning();
		let timeout: ReturnType<typeof setTimeout> | undefined;
		try {
			return await Promise.race([
				this.state.ready.promise,
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

	command(action: "start" | "shutdown" | "tick"): Promise<unknown>;
	command(action: "observe", input: OperatorObservationInput): Promise<unknown>;
	command(action: "source-action", input: SourceActionInput): Promise<unknown>;
	command(action: "source-action-cancel", input: string): Promise<unknown>;
	command(action: SessionWorkerAction, input?: unknown): Promise<unknown> {
		if (this.state.state !== "online" && this.state.state !== "shutting_down")
			throw this.notRunning();
		const pending = this.state.pending;
		if (pending.size >= PENDING_COMMAND_CAPACITY)
			throw new Error(
				`Session worker pending command capacity ${PENDING_COMMAND_CAPACITY} exceeded`,
			);
		const id = `${action}-${crypto.randomUUID()}`;
		const command = workerCommand(action, id, input);
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				if (!pending.delete(id)) return;
				reject(
					new WorkerCommandTimeoutError(action, this.options.commandTimeoutMs),
				);
			}, this.options.commandTimeoutMs);
			timeout.unref?.();
			pending.set(id, { resolve, reject, timeout });
			try {
				this.child.send(command);
			} catch (error) {
				clearTimeout(timeout);
				pending.delete(id);
				reject(asError(error));
			}
		});
	}

	shutdown(
		options: SessionProcessShutdownOptions,
	): Promise<SessionProcessShutdownResult> {
		if (this.state.state === "exited")
			return Promise.resolve({ mode: "graceful" });
		if (this.state.state === "shutting_down") return this.state.operation;
		const pending =
			this.state.state === "online"
				? this.state.pending
				: new Map<string, PendingCommand>();
		if (this.state.state === "waiting")
			this.state.ready.reject(this.notRunning());
		const shutting: Extract<ProcessState, { state: "shutting_down" }> = {
			state: "shutting_down",
			pending,
			operation: Promise.resolve({ mode: "graceful" }),
		};
		this.state = shutting;
		shutting.operation = this.runShutdown(options);
		return shutting.operation;
	}

	forceClose(): void {
		if (this.state.state !== "exited") this.child.kill("SIGKILL");
	}

	private notRunning(): Error {
		if (this.state.state === "exited") return this.state.error;
		return new WorkerExitedError({
			phase: "process",
			diagnostic: this.diagnostic,
			message: "Session worker is not running.",
		});
	}

	private async runShutdown(
		options: SessionProcessShutdownOptions,
	): Promise<SessionProcessShutdownResult> {
		void this.command("shutdown").catch(() => undefined);
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
		if (this.state.state === "exited") return true;
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

	private receive(message: unknown): void {
		try {
			this.handleRecord(decodeSessionWorkerRecord(message));
		} catch (error) {
			this.transitionToExited(asError(error));
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
	}

	private handleRecord(record: SessionWorkerRecord): void {
		if (record.kind === "failure") {
			this.transitionToExited(workerBoundaryError(record.error));
			return;
		}
		if (record.kind === "ready" && this.state.state === "waiting") {
			this.state.ready.resolve(record);
			this.state = {
				state: "online",
				ready: record,
				pending: new Map(),
			};
		}
		if (
			record.kind === "result" &&
			(this.state.state === "online" || this.state.state === "shutting_down")
		) {
			const pending = this.state.pending.get(record.id);
			if (pending !== undefined) {
				clearTimeout(pending.timeout);
				this.state.pending.delete(record.id);
				if (record.ok) pending.resolve(record.value);
				else pending.reject(workerBoundaryError(record.error));
			}
		}
		for (const listener of this.listeners) listener(record);
	}

	private transitionToExited(error: Error, exit?: SessionChildExit): void {
		if (this.state.state === "exited") return;
		this.stopMessages();
		const previous = this.state;
		const expected = previous.state === "shutting_down";
		if (previous.state === "waiting") previous.ready.reject(error);
		const pending =
			previous.state === "online" || previous.state === "shutting_down"
				? previous.pending
				: new Map<string, PendingCommand>();
		for (const command of pending.values()) {
			clearTimeout(command.timeout);
			command.reject(error);
		}
		pending.clear();
		this.state =
			exit === undefined
				? { state: "exited", error }
				: { state: "exited", error, exit };
		if (!expected) for (const listener of this.exitListeners) listener(error);
	}
}
