import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { PlotBoundaryError } from "@plot/common/boundary-error";
import { EventHub } from "@plot/common/event-stream";
import { errorMessage } from "@plot/common/primitives";
import type {
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

const LIVE_EVENT_CAPACITY = 1024;

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

export interface SessionManagerClient {
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
	readonly canonicalize?: (path: string) => Promise<string>;
}

interface LiveMetadata {
	workflowName: string;
	workflowPath: string;
	projectPath: string;
	historyPath: string;
}

type LiveState =
	| { readonly state: "starting" }
	| { readonly state: "online" }
	| { readonly state: "stopping" }
	| { readonly state: "failing"; readonly operation: Promise<void> };

interface LiveSession {
	readonly id: string;
	readonly workflowKey: string;
	readonly aliases: Set<string>;
	readonly createdAt: string;
	updatedAt: string;
	readonly metadata: LiveMetadata;
	readonly process: SessionProcess;
	readonly events: EventHub<RuntimeEvent>;
	state: LiveState;
	diagnostic?: string;
	readonly cleanup: () => void;
}

type WorkflowState =
	| { readonly state: "idle" }
	| {
			readonly state: "starting";
			readonly operation: Promise<StartSessionResult>;
	  }
	| { readonly state: "online"; readonly session: LiveSession }
	| {
			readonly state: "stopping";
			readonly session: LiveSession;
			readonly operation: Promise<SessionSummary>;
	  };

interface WorkflowOwner {
	readonly workflowKey: string;
	readonly aliases: Set<string>;
	state: WorkflowState;
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

export class SessionManager implements SessionManagerClient {
	private readonly live = new Map<string, LiveSession>();
	private readonly workflows = new Map<string, WorkflowOwner>();
	private accepting = true;
	private shutdownOperation: Promise<void> | undefined;
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

	private summary(
		live: LiveSession,
		state: SessionState = live.state.state === "failing"
			? "error"
			: live.state.state,
	): SessionSummary {
		const summary: SessionSummary = {
			id: live.id,
			workflowKey: live.workflowKey,
			workflowName: live.metadata.workflowName,
			workflowPath: live.metadata.workflowPath,
			workflowAliases: [...live.aliases],
			projectPath: live.metadata.projectPath,
			state,
			createdAt: live.createdAt,
			updatedAt: live.updatedAt,
			historyPath: live.metadata.historyPath,
		};
		const processDiagnostic = live.process.diagnosticTail();
		if (live.diagnostic === undefined && processDiagnostic.length === 0)
			return summary;
		const diagnostic =
			live.diagnostic === undefined
				? processDiagnostic
				: this.appendDiagnostic(processDiagnostic, live.diagnostic);
		return { ...summary, diagnostic };
	}

	private ownerFor(workflowKey: string, aliases: readonly string[]) {
		const found = [workflowKey, ...aliases]
			.map((key) => this.workflows.get(key))
			.find((owner) => owner !== undefined);
		const owner: WorkflowOwner = found ?? {
			workflowKey,
			aliases: new Set(),
			state: { state: "idle" },
		};
		const ownedAliases = owner.aliases;
		for (const alias of [workflowKey, ...aliases]) {
			const conflict = this.workflows.get(alias);
			if (conflict !== undefined && conflict !== owner)
				throw new Error(`Conflicting Workflow lifecycle identity: ${alias}`);
			ownedAliases.add(alias);
			this.workflows.set(alias, owner);
		}
		return owner;
	}

	private release(owner: WorkflowOwner): void {
		if (owner.state.state !== "idle") return;
		for (const alias of owner.aliases)
			if (this.workflows.get(alias) === owner) this.workflows.delete(alias);
	}

	private async workflowKey(input: StartWorkflow): Promise<string> {
		return this.options.canonicalize(resolveWorkflowPath(input));
	}

	private async workflowLookupKeys(path: string): Promise<Set<string>> {
		const normalized = resolve(path);
		const keys = new Set([normalized]);
		try {
			keys.add(await this.options.canonicalize(normalized));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		return keys;
	}

	async start(input: StartWorkflow): Promise<StartSessionResult> {
		if (!this.accepting) throw new SessionManagerShuttingDownError();
		const alias = resolve(resolveWorkflowPath(input));
		const key = await this.workflowKey(input);
		const owner = this.ownerFor(key, [alias]);
		const state = owner.state;
		owner.aliases.add(alias);
		if (state.state === "starting")
			return state.operation.then((result) => ({
				session: this.summary(this.live.get(result.session.id)!),
				started: false,
			}));
		if (state.state === "online") {
			state.session.aliases.add(alias);
			state.session.updatedAt = this.options.now();
			await this.options.store.upsert(this.summary(state.session));
			return { session: this.summary(state.session), started: false };
		}
		if (state.state === "stopping") {
			await state.operation.catch(() => undefined);
			return this.start(input);
		}
		return this.beginStart(owner, resolve(input.cwd));
	}

	private beginStart(
		owner: WorkflowOwner,
		projectPath: string,
	): Promise<StartSessionResult> {
		let operation!: Promise<StartSessionResult>;
		operation = this.startSession(owner, projectPath).then(
			(live) => {
				if (
					owner.state.state === "starting" &&
					owner.state.operation === operation
				)
					owner.state = { state: "online", session: live };
				return { session: this.summary(live), started: true };
			},
			(error: unknown) => {
				if (
					owner.state.state === "starting" &&
					owner.state.operation === operation
				) {
					owner.state = { state: "idle" };
					this.release(owner);
				}
				throw error;
			},
		);
		owner.state = { state: "starting", operation };
		return operation;
	}

	private async startSession(
		owner: WorkflowOwner,
		projectPath: string,
	): Promise<LiveSession> {
		if (!this.accepting) throw new SessionManagerShuttingDownError();
		const id = this.options.id();
		const child = (this.options.spawnChild ?? createSessionChildProcess)({
			command: this.options.cli.command,
			args: workerArgs({
				cliArgs: this.options.cli.args,
				cwd: projectPath,
				sessionId: id,
				workflowPath: owner.workflowKey,
			}),
			cwd: projectPath,
		});
		const process = new SessionProcess(child, {
			diagnosticLimitBytes: this.options.diagnosticLimitBytes,
			commandTimeoutMs: this.options.commandTimeoutMs,
		});
		const createdAt = this.options.now();
		const events = new EventHub<RuntimeEvent>(LIVE_EVENT_CAPACITY);
		const unsubscribes: (() => void)[] = [];
		const live: LiveSession = {
			id,
			workflowKey: owner.workflowKey,
			aliases: owner.aliases,
			createdAt,
			updatedAt: createdAt,
			metadata: {
				workflowName: basename(owner.workflowKey),
				workflowPath: owner.workflowKey,
				projectPath,
				historyPath: resolve(projectPath, ".plot", "sessions", `${id}.jsonl`),
			},
			process,
			events,
			state: { state: "starting" },
			cleanup: () => unsubscribes.forEach((unsubscribe) => unsubscribe()),
		};
		unsubscribes.push(
			process.onRecord((record) => {
				if (record.kind === "event") events.publish(record.event);
			}),
			process.onExit((error) => {
				if (live.state.state === "online") void this.fail(owner, live, error);
			}),
		);
		let committed = false;
		try {
			const ready = await process.waitUntilReady(this.options.readyTimeoutMs);
			live.metadata.workflowName = ready.workflowName;
			live.metadata.workflowPath = ready.workflowPath;
			live.metadata.projectPath = ready.projectPath;
			live.metadata.historyPath = ready.historyPath;
			this.live.set(id, live);
			committed = true;
			await this.options.store.upsert(this.summary(live));
			await process.command("start");
			live.state = { state: "online" };
			live.updatedAt = this.options.now();
			await this.options.store.upsert(this.summary(live));
			return live;
		} catch (error) {
			if (committed) {
				live.diagnostic = this.appendDiagnostic(
					live.diagnostic,
					errorMessage(error),
				);
				live.updatedAt = this.options.now();
				await this.options.store
					.upsert(this.summary(live, "error"))
					.catch(() => undefined);
				this.releaseLive(live);
			}
			await process
				.shutdown({ ...this.shutdownOptions(), gracefulMs: 0 })
				.catch(() => undefined);
			if (!committed) {
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
		this.live.delete(live.id);
	}

	private fail(
		owner: WorkflowOwner,
		live: LiveSession,
		error: unknown,
	): Promise<void> {
		if (live.state.state === "stopping") return Promise.resolve();
		if (live.state.state === "failing") return live.state.operation;
		if (this.live.get(live.id) !== live) return Promise.resolve();
		const operation = (async () => {
			live.diagnostic = this.appendDiagnostic(
				live.diagnostic,
				errorMessage(error),
			);
			live.updatedAt = this.options.now();
			await this.options.store
				.upsert(this.summary(live, "error"))
				.catch(() => undefined);
			await live.process
				.shutdown(this.shutdownOptions())
				.catch(() => undefined);
			this.releaseLive(live);
			if (owner.state.state === "online" && owner.state.session === live) {
				owner.state = { state: "idle" };
				this.release(owner);
			}
		})();
		live.state = { state: "failing", operation };
		return operation;
	}

	async find(path: string): Promise<SessionSummary | undefined> {
		const keys = await this.workflowLookupKeys(path);
		for (const key of keys) {
			const owner = this.workflows.get(key);
			if (owner?.state.state === "online")
				return this.summary(owner.state.session);
		}
		return;
	}

	async get(id: string): Promise<SessionSummary | undefined> {
		const live = this.live.get(id);
		return live === undefined ? this.options.store.get(id) : this.summary(live);
	}

	async stop(path: string): Promise<SessionSummary | undefined> {
		const keys = await this.workflowLookupKeys(path);
		const owners = new Set(
			[...keys]
				.map((key) => this.workflows.get(key))
				.filter((owner) => owner !== undefined),
		);
		if (owners.size > 1)
			throw new Error(`Conflicting Workflow lifecycle identity: ${path}`);
		const owner = owners.values().next().value as WorkflowOwner | undefined;
		if (owner !== undefined) return this.stopOwner(owner);
		return (await this.options.store.list()).find(
			(session) =>
				keys.has(session.workflowKey) ||
				session.workflowAliases.some((alias) => keys.has(alias)),
		);
	}

	async stopSession(id: string): Promise<SessionSummary | undefined> {
		const live = this.live.get(id);
		if (live === undefined) return this.options.store.get(id);
		const owner = this.workflows.get(live.workflowKey);
		return owner === undefined ? undefined : this.stopOwner(owner, id);
	}

	private stopOwner(
		owner: WorkflowOwner,
		id?: string,
	): Promise<SessionSummary | undefined> {
		const state = owner.state;
		if (state.state === "idle") return Promise.resolve(undefined);
		if (state.state === "starting")
			return state.operation.then(
				() => this.stopOwner(owner, id),
				() => undefined,
			);
		if (state.state === "stopping") return state.operation;
		if (id !== undefined && state.session.id !== id)
			return Promise.resolve(undefined);
		const live = state.session;
		let operation!: Promise<SessionSummary>;
		operation = this.stopLive(live).then(
			(summary) => {
				if (
					owner.state.state === "stopping" &&
					owner.state.operation === operation
				) {
					owner.state = { state: "idle" };
					this.release(owner);
				}
				return summary;
			},
			(error: unknown) => {
				if (
					owner.state.state === "stopping" &&
					owner.state.operation === operation
				) {
					owner.state = { state: "idle" };
					this.release(owner);
				}
				throw error;
			},
		);
		owner.state = { state: "stopping", session: live, operation };
		return operation;
	}

	private async stopLive(live: LiveSession): Promise<SessionSummary> {
		live.state = { state: "stopping" };
		live.updatedAt = this.options.now();
		let persistenceFailure: unknown;
		await this.options.store
			.upsert(this.summary(live))
			.catch((error) => (persistenceFailure = error));
		try {
			const termination = await live.process.shutdown(this.shutdownOptions());
			if (termination.mode !== "graceful")
				live.diagnostic = this.appendDiagnostic(
					live.diagnostic,
					`Session worker shutdown mode: ${termination.mode}`,
				);
		} catch (error) {
			live.diagnostic = this.appendDiagnostic(
				live.diagnostic,
				errorMessage(error),
			);
			live.updatedAt = this.options.now();
			const summary = this.summary(live, "error");
			this.releaseLive(live);
			await this.options.store.upsert(summary).catch(() => undefined);
			throw error;
		}
		live.updatedAt = this.options.now();
		const summary = this.summary(live, "stopped");
		this.releaseLive(live);
		await this.options.store.upsert(summary);
		if (persistenceFailure !== undefined) throw persistenceFailure;
		return summary;
	}

	async list(): Promise<readonly SessionSummary[]> {
		const sessions = new Map(
			(await this.options.store.list()).map((session) => [session.id, session]),
		);
		for (const live of this.live.values())
			sessions.set(live.id, this.summary(live));
		return [...sessions.values()];
	}

	events(
		id: string,
		after = 0,
		signal?: AbortSignal,
	): AsyncIterable<RuntimeEvent> {
		const getSession = () => this.get(id);
		const getLive = () => this.live.get(id);
		return {
			async *[Symbol.asyncIterator]() {
				const session = await getSession();
				if (session === undefined) throw new SessionNotFoundError(id);
				const live = getLive();
				const input: Parameters<typeof sessionEvents>[0] = {
					historyPath: session.historyPath,
					after,
				};
				if (live !== undefined)
					(input as { live?: () => AsyncIterable<RuntimeEvent> }).live = () =>
						live.events.subscribe(signal);
				yield* sessionEvents(input);
			},
		};
	}

	private async process(
		id: string,
		operation: SessionControlOperation,
	): Promise<SessionProcess> {
		const live = this.live.get(id);
		const session =
			live === undefined
				? await this.options.store.get(id)
				: this.summary(live);
		if (session === undefined) throw new SessionNotFoundError(id);
		if (!this.accepting || live === undefined || live.state.state !== "online")
			throw new SessionNotControllableError({
				sessionId: id,
				state: session.state,
				operation,
			});
		return live.process;
	}

	async tick(id: string): Promise<void> {
		await (await this.process(id, "tick")).command("tick");
	}

	async startSourceAction(
		id: string,
		input: SourceActionInput,
	): Promise<SourceActionStartResult> {
		return (await (
			await this.process(id, "source-action")
		).command("source-action", input)) as SourceActionStartResult;
	}

	async cancelSourceAction(id: string, actionRunId: string): Promise<boolean> {
		return (
			(await (
				await this.process(id, "source-action-cancel")
			).command("source-action-cancel", actionRunId)) === true
		);
	}

	async observe(id: string, input: OperatorObservationInput): Promise<boolean> {
		return (
			(await (await this.process(id, "observe")).command("observe", input)) ===
			true
		);
	}

	forceClose(): void {
		this.accepting = false;
		for (const live of this.live.values()) live.process.forceClose();
	}

	shutdown(): Promise<void> {
		this.shutdownOperation ??= (async () => {
			this.accepting = false;
			await Promise.all(
				[...new Set(this.workflows.values())].map((owner) =>
					this.stopOwner(owner),
				),
			);
		})();
		return this.shutdownOperation;
	}
}
