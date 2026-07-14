import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { PlotBoundaryError } from "@plot/common/boundary-error";
import { EventHub } from "@plot/common/event-stream";
import { errorMessage } from "@plot/common/primitives";
import type {
	InterruptAgentRunInput,
	OperatorObservationInput,
	RuntimeEvent,
	SourceActionInput,
	SourceActionStartResult,
} from "@plot/session/runtime";
import { resolveWorkflowPath } from "@plot/session/workflow";
import { sessionEvents } from "./events.js";
import {
	SessionProcess,
	createSessionChildProcess,
	trimDiagnostic,
	type SessionChildProcess,
	type SessionProcessShutdownOptions,
} from "./session-process.js";
import type { SessionState, SessionSummary } from "./session.js";
import type { SessionStore } from "./session-store.js";

export interface StartWorkflow {
	readonly cwd: string;
	readonly workflowPath?: string;
}

export interface StartSessionResult {
	readonly session: SessionSummary;
	readonly started: boolean;
}

export type SessionControlOperation =
	| "tick"
	| "pause"
	| "resume"
	| "interrupt"
	| "observe"
	| "source-action"
	| "source-action-cancel";

export class SessionNotFoundError extends PlotBoundaryError {
	override readonly name = "SessionNotFoundError";
	readonly sessionId: string;

	constructor(sessionId: string) {
		super({
			code: "session_not_found",
			message: `Unknown Session: ${sessionId}`,
			retryable: false,
			context: { sessionId },
		});
		this.sessionId = sessionId;
	}
}

export class SessionNotControllableError extends PlotBoundaryError {
	override readonly name = "SessionNotControllableError";
	readonly sessionId: string;
	readonly state: SessionState;
	readonly operation: SessionControlOperation;

	constructor(input: {
		readonly sessionId: string;
		readonly state: SessionState;
		readonly operation: SessionControlOperation;
	}) {
		super({
			code: "session_not_controllable",
			message: `Session ${input.sessionId} is ${input.state}; cannot ${input.operation}.`,
			retryable: input.state === "starting" || input.state === "stopping",
			context: input,
		});
		this.sessionId = input.sessionId;
		this.state = input.state;
		this.operation = input.operation;
	}
}

export class SessionManagerShuttingDownError extends PlotBoundaryError {
	override readonly name = "SessionManagerShuttingDownError";

	constructor() {
		super({
			code: "manager_shutting_down",
			message: "Session Manager is shutting down.",
			retryable: true,
		});
	}
}

export interface SessionManagerRuntime {
	readonly start: (input: StartWorkflow) => Promise<StartSessionResult>;
	readonly find: (workflowPath: string) => Promise<SessionSummary | undefined>;
	readonly get: (sessionId: string) => Promise<SessionSummary | undefined>;
	readonly stop: (workflowPath: string) => Promise<SessionSummary | undefined>;
	readonly stopSession: (
		sessionId: string,
	) => Promise<SessionSummary | undefined>;
	readonly list: () => Promise<readonly SessionSummary[]>;
	readonly events: (
		sessionId: string,
		after?: number,
		signal?: AbortSignal,
	) => AsyncIterable<RuntimeEvent>;
	readonly tick: (sessionId: string) => Promise<void>;
	readonly pause: (sessionId: string) => Promise<void>;
	readonly resume: (sessionId: string) => Promise<void>;
	readonly interrupt: (
		sessionId: string,
		input: InterruptAgentRunInput,
	) => Promise<boolean>;
	readonly startSourceAction: (
		sessionId: string,
		input: SourceActionInput,
	) => Promise<SourceActionStartResult>;
	readonly cancelSourceAction: (
		sessionId: string,
		actionRunId: string,
	) => Promise<boolean>;
	readonly observe: (
		sessionId: string,
		input: OperatorObservationInput,
	) => Promise<boolean>;
	readonly shutdown: () => Promise<void>;
}

export interface SessionManagerOptions {
	readonly store: SessionStore;
	readonly cli: { readonly command: string; readonly args: readonly string[] };
	readonly spawnChild?: (input: {
		readonly command: string;
		readonly args: readonly string[];
		readonly cwd: string;
	}) => SessionChildProcess;
	readonly now?: () => string;
	readonly id?: () => string;
	readonly readyTimeoutMs?: number;
	readonly commandTimeoutMs?: number;
	readonly gracefulShutdownMs?: number;
	readonly terminateShutdownMs?: number;
	readonly killShutdownMs?: number;
	readonly diagnosticLimitBytes?: number;
	readonly eventCapacity?: number;
	readonly canonicalize?: (path: string) => Promise<string>;
}

interface LiveSession {
	summary: SessionSummary;
	readonly process: SessionProcess;
	readonly events: EventHub<RuntimeEvent>;
	cleanup: () => void;
	closing?: Promise<void>;
}

interface WorkflowLifecycleSlot {
	readonly workflowKey: string;
	readonly aliases: Set<string>;
	tail: Promise<void>;
	pendingStart: Promise<StartSessionResult> | undefined;
	pendingStop: Promise<SessionSummary | undefined> | undefined;
}

const workerArgs = (input: {
	readonly cliArgs: readonly string[];
	readonly cwd: string;
	readonly sessionId: string;
	readonly workflowPath: string;
}): readonly string[] => [
	...input.cliArgs,
	"__internal-session-worker",
	"--cwd",
	input.cwd,
	"--session-id",
	input.sessionId,
	"--workflow",
	input.workflowPath,
];

export class SessionManager implements SessionManagerRuntime {
	private readonly live = new Map<string, LiveSession>();
	private readonly lifecycles = new Map<string, WorkflowLifecycleSlot>();
	private accepting = true;
	private shutdownPromise: Promise<void> | undefined;
	private readonly options: Required<
		Pick<
			SessionManagerOptions,
			| "now"
			| "id"
			| "readyTimeoutMs"
			| "commandTimeoutMs"
			| "gracefulShutdownMs"
			| "terminateShutdownMs"
			| "killShutdownMs"
			| "diagnosticLimitBytes"
			| "eventCapacity"
			| "canonicalize"
		>
	> &
		SessionManagerOptions;

	constructor(options: SessionManagerOptions) {
		this.options = {
			...options,
			now: options.now ?? (() => new Date().toISOString()),
			id: options.id ?? (() => `session-${randomUUID()}`),
			readyTimeoutMs: options.readyTimeoutMs ?? 10_000,
			commandTimeoutMs: options.commandTimeoutMs ?? 30_000,
			gracefulShutdownMs: options.gracefulShutdownMs ?? 30_000,
			terminateShutdownMs: options.terminateShutdownMs ?? 5_000,
			killShutdownMs: options.killShutdownMs ?? 2_000,
			diagnosticLimitBytes: options.diagnosticLimitBytes ?? 16 * 1024,
			eventCapacity: options.eventCapacity ?? 1024,
			canonicalize: options.canonicalize ?? realpath,
		};
	}

	async recoverAfterRestart(): Promise<void> {
		await this.options.store.recoverAfterRestart();
	}

	private shutdownOptions(): SessionProcessShutdownOptions {
		return {
			gracefulMs: this.options.gracefulShutdownMs,
			terminateMs: this.options.terminateShutdownMs,
			killMs: this.options.killShutdownMs,
		};
	}

	private async workflowKey(input: StartWorkflow): Promise<string> {
		return this.options.canonicalize(resolveWorkflowPath(input));
	}

	private async workflowLookupKeys(
		workflowPath: string,
	): Promise<ReadonlySet<string>> {
		const normalized = resolve(workflowPath);
		const keys = new Set([normalized]);
		try {
			keys.add(await this.options.canonicalize(normalized));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		return keys;
	}

	private slotFor(
		workflowKey: string,
		aliases: readonly string[],
	): WorkflowLifecycleSlot {
		const found = [workflowKey, ...aliases]
			.map((key) => this.lifecycles.get(key))
			.find((slot) => slot !== undefined);
		const slot =
			found ??
			({
				workflowKey,
				aliases: new Set<string>(),
				tail: Promise.resolve(),
				pendingStart: undefined,
				pendingStop: undefined,
			} satisfies WorkflowLifecycleSlot);
		for (const alias of [workflowKey, ...aliases]) {
			const conflict = this.lifecycles.get(alias);
			if (conflict !== undefined && conflict !== slot)
				throw new Error(`Conflicting Workflow lifecycle identity: ${alias}`);
			slot.aliases.add(alias);
			this.lifecycles.set(alias, slot);
		}
		return slot;
	}

	private enqueue<A>(
		slot: WorkflowLifecycleSlot,
		operation: () => Promise<A>,
	): Promise<A> {
		const next = slot.tail.then(operation, operation);
		slot.tail = next.then(
			() => undefined,
			() => undefined,
		);
		return next;
	}

	private releaseSlotIfIdle(slot: WorkflowLifecycleSlot): void {
		if (slot.pendingStart !== undefined || slot.pendingStop !== undefined)
			return;
		const active = [...this.live.values()].some(
			(live) => live.summary.workflowKey === slot.workflowKey,
		);
		if (active) return;
		for (const alias of slot.aliases)
			if (this.lifecycles.get(alias) === slot) this.lifecycles.delete(alias);
	}

	private async rememberWorkflowAlias(
		session: SessionSummary,
		workflowAlias: string,
		slot?: WorkflowLifecycleSlot,
	): Promise<SessionSummary> {
		slot?.aliases.add(workflowAlias);
		if (slot !== undefined) this.lifecycles.set(workflowAlias, slot);
		if (session.workflowAliases.includes(workflowAlias)) return session;
		const updated = {
			...session,
			workflowAliases: [...session.workflowAliases, workflowAlias],
			updatedAt: this.options.now(),
		};
		const live = this.live.get(session.id);
		if (live !== undefined) live.summary = updated;
		await this.options.store.upsert(updated);
		return updated;
	}

	private activeForWorkflow(workflowKey: string): SessionSummary | undefined {
		for (const live of this.live.values())
			if (
				live.summary.workflowKey === workflowKey ||
				live.summary.workflowAliases.includes(workflowKey)
			)
				return live.summary;
		return undefined;
	}

	async start(input: StartWorkflow): Promise<StartSessionResult> {
		if (!this.accepting) throw new SessionManagerShuttingDownError();
		const workflowAlias = resolve(resolveWorkflowPath(input));
		const workflowKey = await this.workflowKey(input);
		const slot = this.slotFor(workflowKey, [workflowAlias]);
		const current = slot.pendingStart;
		if (current !== undefined)
			return this.enqueue(slot, async () => {
				const result = await current;
				return {
					session: await this.rememberWorkflowAlias(
						result.session,
						workflowAlias,
						slot,
					),
					started: false,
				};
			});
		const start = this.enqueue(slot, async () => {
			if (!this.accepting) throw new SessionManagerShuttingDownError();
			const existing = await this.activeForWorkflow(workflowKey);
			if (existing !== undefined)
				return {
					session: await this.rememberWorkflowAlias(
						existing,
						workflowAlias,
						slot,
					),
					started: false,
				};
			return this.startSession(slot, resolve(input.cwd), workflowAlias);
		});
		slot.pendingStart = start;
		try {
			return await start;
		} finally {
			if (slot.pendingStart === start) slot.pendingStart = undefined;
			this.releaseSlotIfIdle(slot);
		}
	}

	private async startSession(
		slot: WorkflowLifecycleSlot,
		projectPath: string,
		workflowAlias: string,
	): Promise<StartSessionResult> {
		const sessionId = this.options.id();
		const child = (this.options.spawnChild ?? createSessionChildProcess)({
			command: this.options.cli.command,
			args: workerArgs({
				cliArgs: this.options.cli.args,
				cwd: projectPath,
				sessionId,
				workflowPath: slot.workflowKey,
			}),
			cwd: projectPath,
		});
		const process = new SessionProcess(child, {
			diagnosticLimitBytes: this.options.diagnosticLimitBytes,
			commandTimeoutMs: this.options.commandTimeoutMs,
		});
		const now = this.options.now();
		const summary: SessionSummary = {
			id: sessionId,
			workflowKey: slot.workflowKey,
			workflowName: basename(slot.workflowKey),
			workflowPath: slot.workflowKey,
			workflowAliases: [workflowAlias],
			projectPath,
			state: "starting",
			createdAt: now,
			updatedAt: now,
			historyPath: resolve(
				projectPath,
				".plot",
				"sessions",
				`${sessionId}.jsonl`,
			),
			lastSequence: 0,
		};
		const events = new EventHub<RuntimeEvent>(this.options.eventCapacity);
		const live: LiveSession = {
			summary,
			process,
			events,
			cleanup: () => {},
		};
		let committed = false;
		const update = async (changes: Partial<SessionSummary>) => {
			live.summary = {
				...live.summary,
				...changes,
				updatedAt: this.options.now(),
			};
			if (committed) await this.options.store.upsert(live.summary);
		};
		const unsubscribes = [
			process.onRecord((record) => {
				if (record.kind !== "event") return;
				events.publish(record.event);
				void update({ lastSequence: record.event.sequence }).catch((error) =>
					this.scheduleFailure(live, error),
				);
			}),
			process.onDiagnostic((diagnostic) => {
				void update({ diagnostic }).catch((error) =>
					this.scheduleFailure(live, error),
				);
			}),
			process.onExit((error) => {
				if (
					live.summary.state === "stopping" ||
					live.summary.state === "stopped"
				)
					return;
				this.scheduleFailure(live, error);
			}),
		];
		live.cleanup = () => unsubscribes.forEach((unsubscribe) => unsubscribe());
		try {
			const ready = await process.waitUntilReady(this.options.readyTimeoutMs);
			await update({
				workflowName: ready.workflowName,
				workflowPath: ready.workflowPath,
				workflowAliases: [...slot.aliases],
				projectPath: ready.projectPath,
				historyPath: ready.historyPath,
			});
			this.live.set(sessionId, live);
			committed = true;
			await this.options.store.upsert(live.summary);
			await process.command("start");
			await update({ state: "online" });
			return { session: live.summary, started: true };
		} catch (error) {
			if (committed) await this.fail(live, error);
			else {
				await process
					.shutdown({ ...this.shutdownOptions(), gracefulMs: 0 })
					.catch(() => undefined);
				live.cleanup();
				events.close();
			}
			throw error;
		}
	}

	private appendDiagnostic(current: string | undefined, value: string): string {
		const separator =
			current === undefined || current.endsWith("\n") ? "" : "\n";
		return trimDiagnostic(
			`${current ?? ""}${separator}${value}`,
			this.options.diagnosticLimitBytes,
		);
	}

	private releaseLive(live: LiveSession): void {
		live.cleanup();
		live.events.close();
		this.live.delete(live.summary.id);
		const slot = this.lifecycles.get(live.summary.workflowKey);
		if (slot !== undefined) this.releaseSlotIfIdle(slot);
	}

	private scheduleFailure(live: LiveSession, error: unknown): void {
		const slot = this.lifecycles.get(live.summary.workflowKey);
		if (slot === undefined) {
			void this.fail(live, error);
			return;
		}
		void this.enqueue(slot, () => this.fail(live, error)).catch(
			() => undefined,
		);
	}

	private fail(live: LiveSession, error: unknown): Promise<void> {
		if (live.summary.state === "stopping" || live.summary.state === "stopped")
			return Promise.resolve();
		if (live.closing !== undefined) return live.closing;
		if (this.live.get(live.summary.id) !== live) return Promise.resolve();
		const closing = (async () => {
			live.summary = {
				...live.summary,
				state: "error",
				updatedAt: this.options.now(),
				diagnostic: this.appendDiagnostic(
					live.summary.diagnostic,
					errorMessage(error),
				),
			};
			try {
				await this.options.store.upsert(live.summary);
			} catch {
				// Process ownership must still be released when persistence is unavailable.
			}
			try {
				await live.process.shutdown(this.shutdownOptions());
			} catch {
				// The original failure owns the Session diagnostic.
			} finally {
				this.releaseLive(live);
			}
		})();
		live.closing = closing;
		return closing;
	}

	async find(workflowPath: string): Promise<SessionSummary | undefined> {
		const keys = await this.workflowLookupKeys(workflowPath);
		return [...keys]
			.map((key) => this.activeForWorkflow(key))
			.find((session) => session !== undefined);
	}

	async get(sessionId: string): Promise<SessionSummary | undefined> {
		return (
			this.live.get(sessionId)?.summary ?? this.options.store.get(sessionId)
		);
	}

	async stop(workflowPath: string): Promise<SessionSummary | undefined> {
		const keys = await this.workflowLookupKeys(workflowPath);
		const slots = new Set(
			[...keys]
				.map((key) => this.lifecycles.get(key))
				.filter((slot) => slot !== undefined),
		);
		if (slots.size > 1)
			throw new Error(
				`Conflicting Workflow lifecycle identity: ${workflowPath}`,
			);
		const slot = slots.values().next().value as
			| WorkflowLifecycleSlot
			| undefined;
		if (slot !== undefined) return this.stopSlot(slot);
		const session = [...keys]
			.map((key) => this.activeForWorkflow(key))
			.find((result) => result !== undefined);
		if (session === undefined) return undefined;
		return this.stopSession(session.id);
	}

	async stopSession(sessionId: string): Promise<SessionSummary | undefined> {
		const live = this.live.get(sessionId);
		if (live === undefined) return this.options.store.get(sessionId);
		const slot = this.slotFor(live.summary.workflowKey, [
			...live.summary.workflowAliases,
		]);
		return this.stopSlot(slot, sessionId);
	}

	private stopSlot(
		slot: WorkflowLifecycleSlot,
		sessionId?: string,
	): Promise<SessionSummary | undefined> {
		const current = slot.pendingStop;
		if (current !== undefined) return current;
		const stop = this.enqueue(slot, async () => {
			const live =
				sessionId === undefined
					? [...this.live.values()].find(
							(item) => item.summary.workflowKey === slot.workflowKey,
						)
					: this.live.get(sessionId);
			if (live === undefined) return undefined;
			return this.stopLiveSession(live);
		});
		slot.pendingStop = stop;
		const finish = () => {
			if (slot.pendingStop === stop) slot.pendingStop = undefined;
			this.releaseSlotIfIdle(slot);
		};
		void stop.then(finish, finish);
		return stop;
	}

	private async stopLiveSession(live: LiveSession): Promise<SessionSummary> {
		live.summary = {
			...live.summary,
			state: "stopping",
			updatedAt: this.options.now(),
		};
		let storageFailure: unknown;
		try {
			await this.options.store.upsert(live.summary);
		} catch (error) {
			storageFailure = error;
		}
		let termination: Awaited<ReturnType<SessionProcess["shutdown"]>>;
		try {
			termination = await live.process.shutdown(this.shutdownOptions());
		} catch (error) {
			live.summary = {
				...live.summary,
				state: "error",
				updatedAt: this.options.now(),
				diagnostic: this.appendDiagnostic(
					live.summary.diagnostic,
					errorMessage(error),
				),
			};
			this.releaseLive(live);
			await this.options.store.upsert(live.summary).catch(() => undefined);
			throw error;
		}
		this.releaseLive(live);
		const diagnostic =
			termination.mode === "graceful"
				? live.summary.diagnostic
				: this.appendDiagnostic(
						live.summary.diagnostic,
						`Session worker shutdown mode: ${termination.mode}`,
					);
		live.summary = {
			...live.summary,
			state: "stopped",
			updatedAt: this.options.now(),
		};
		if (diagnostic !== undefined)
			live.summary = { ...live.summary, diagnostic };
		await this.options.store.upsert(live.summary);
		if (storageFailure !== undefined) throw storageFailure;
		return live.summary;
	}

	async list(): Promise<readonly SessionSummary[]> {
		const sessions = new Map(
			(await this.options.store.list()).map((session) => [session.id, session]),
		);
		for (const live of this.live.values())
			sessions.set(live.summary.id, live.summary);
		return [...sessions.values()];
	}

	events(
		sessionId: string,
		after = 0,
		signal?: AbortSignal,
	): AsyncIterable<RuntimeEvent> {
		const getSession = () => this.get(sessionId);
		const getLive = () => this.live.get(sessionId);
		return {
			async *[Symbol.asyncIterator]() {
				const session = await getSession();
				if (session === undefined) throw new SessionNotFoundError(sessionId);
				const live = getLive();
				const input: {
					historyPath: string;
					after: number;
					live?: AsyncIterable<RuntimeEvent>;
				} = { historyPath: session.historyPath, after };
				if (live !== undefined) input.live = live.events.subscribe(signal);
				yield* sessionEvents(input);
			},
		};
	}

	private async process(
		sessionId: string,
		operation: SessionControlOperation,
	): Promise<SessionProcess> {
		const live = this.live.get(sessionId);
		const session = live?.summary ?? (await this.options.store.get(sessionId));
		if (session === undefined) throw new SessionNotFoundError(sessionId);
		if (!this.accepting || live === undefined || session.state !== "online")
			throw new SessionNotControllableError({
				sessionId,
				state: session.state,
				operation,
			});
		return live.process;
	}

	async tick(sessionId: string): Promise<void> {
		await (await this.process(sessionId, "tick")).command("tick");
	}

	async pause(sessionId: string): Promise<void> {
		await (await this.process(sessionId, "pause")).command("pause");
	}

	async resume(sessionId: string): Promise<void> {
		await (await this.process(sessionId, "resume")).command("resume");
	}

	async interrupt(
		sessionId: string,
		input: InterruptAgentRunInput,
	): Promise<boolean> {
		return (
			(await (
				await this.process(sessionId, "interrupt")
			).command("interrupt", input)) === true
		);
	}

	async startSourceAction(
		sessionId: string,
		input: SourceActionInput,
	): Promise<SourceActionStartResult> {
		return (await (
			await this.process(sessionId, "source-action")
		).command("source-action", input)) as SourceActionStartResult;
	}

	async cancelSourceAction(
		sessionId: string,
		actionRunId: string,
	): Promise<boolean> {
		return (
			(await (
				await this.process(sessionId, "source-action-cancel")
			).command("source-action-cancel", actionRunId)) === true
		);
	}

	async observe(
		sessionId: string,
		input: OperatorObservationInput,
	): Promise<boolean> {
		return (
			(await (
				await this.process(sessionId, "observe")
			).command("observe", input)) === true
		);
	}

	forceClose(): void {
		this.accepting = false;
		for (const live of this.live.values()) live.process.forceClose();
	}

	shutdown(): Promise<void> {
		this.shutdownPromise ??= (async () => {
			this.accepting = false;
			await Promise.all(
				[...new Set(this.lifecycles.values())].map((slot) =>
					this.stopSlot(slot),
				),
			);
		})();
		return this.shutdownPromise;
	}
}
