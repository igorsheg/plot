import { spawn, type ChildProcess } from "node:child_process";
import { jsonlLines } from "@plot/common/jsonl";
import {
	decodeSessionWorkerRecord,
	encodeSessionWorkerRecord,
	workerMaxLineBytes,
	type SessionWorkerAction,
	type SessionWorkerCommand,
	type SessionWorkerReady,
	type SessionWorkerRecord,
} from "@plot/session/worker";

export interface SessionChildProcess {
	readonly pid?: number | undefined;
	readonly stdout: AsyncIterable<string | Uint8Array>;
	readonly stderr: AsyncIterable<string | Uint8Array>;
	readonly write: (line: string) => Promise<void> | void;
	readonly kill: (signal?: NodeJS.Signals) => void;
	readonly exited: Promise<void>;
}

interface PendingCommand {
	readonly action: SessionWorkerAction;
	readonly resolve: (value: unknown) => void;
	readonly reject: (error: Error) => void;
	readonly timeout: ReturnType<typeof setTimeout>;
}

const asError = (error: unknown): Error =>
	error instanceof Error ? error : new Error(String(error));

export const trimDiagnostic = (value: string, maxBytes: number): string => {
	const bytes = new TextEncoder().encode(value);
	if (bytes.length <= maxBytes) return value;
	return new TextDecoder().decode(bytes.slice(bytes.length - maxBytes));
};

export const createSessionChildProcess = (input: {
	readonly command: string;
	readonly args: readonly string[];
	readonly cwd: string;
}): SessionChildProcess => {
	const child: ChildProcess = spawn(input.command, [...input.args], {
		cwd: input.cwd,
		stdio: ["pipe", "pipe", "pipe"],
	});
	const killOnParentExit = () => child.kill("SIGTERM");
	process.once("exit", killOnParentExit);
	child.once("exit", () => process.off("exit", killOnParentExit));
	child.once("error", () => process.off("exit", killOnParentExit));
	return {
		pid: child.pid,
		stdout: child.stdout!,
		stderr: child.stderr!,
		write: (line) =>
			new Promise<void>((resolve, reject) => {
				child.stdin!.write(line, (error) => {
					if (error == null) resolve();
					else reject(error);
				});
			}),
		kill: (signal) => child.kill(signal),
		exited: new Promise((resolve) => {
			child.once("exit", () => resolve());
			child.once("error", () => resolve());
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
	private exited = false;
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
		void this.consumeStdout();
		void this.consumeStderr();
		void child.exited.then(() =>
			this.fail(new Error(`Session worker exited. Stderr: ${this.diagnostic}`)),
		);
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
						() => reject(new Error("Session worker did not become ready")),
						ms,
					);
				}),
			]);
		} finally {
			if (timeout !== undefined) clearTimeout(timeout);
		}
	}

	command(action: SessionWorkerAction, input?: unknown): Promise<unknown> {
		if (this.exited) throw new Error("Session worker is not running");
		const id = `${action}-${crypto.randomUUID()}`;
		const command: SessionWorkerCommand = { kind: "command", id, action };
		const value = input === undefined ? command : { ...command, input };
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				if (!this.pending.delete(id)) return;
				reject(
					new Error(
						`Session worker command ${action} timed out after ${this.options.commandTimeoutMs}ms`,
					),
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

	kill(signal?: NodeJS.Signals): void {
		this.child.kill(signal);
	}

	private async consumeStdout(): Promise<void> {
		try {
			for await (const line of jsonlLines(this.child.stdout, {
				maxLineBytes: workerMaxLineBytes,
			})) {
				if (line.trim() === "") continue;
				this.handleRecord(decodeSessionWorkerRecord(JSON.parse(line)));
			}
		} catch (error) {
			this.fail(asError(error));
		}
	}

	private async consumeStderr(): Promise<void> {
		const decoder = new TextDecoder();
		try {
			for await (const chunk of this.child.stderr) {
				const text = typeof chunk === "string" ? chunk : decoder.decode(chunk);
				this.diagnostic = trimDiagnostic(
					`${this.diagnostic}${text}`,
					this.options.diagnosticLimitBytes,
				);
				for (const listener of this.diagnosticListeners)
					listener(this.diagnostic);
			}
		} catch (error) {
			this.fail(asError(error));
		}
	}

	private handleRecord(record: SessionWorkerRecord): void {
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
				else pending.reject(new Error(record.error));
			}
		}
		for (const listener of this.listeners) listener(record);
	}

	private fail(error: Error): void {
		if (this.exited) return;
		this.exited = true;
		if (this.readyRecord === undefined) this.rejectReady(error);
		for (const pending of this.pending.values()) {
			clearTimeout(pending.timeout);
			pending.reject(error);
		}
		this.pending.clear();
		for (const listener of this.exitListeners) listener(error);
	}
}
