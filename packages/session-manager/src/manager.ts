import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
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
const COMMAND_TIMEOUT_MS = 30_000;
const TERMINATE_SHUTDOWN_MS = 5_000;
const KILL_SHUTDOWN_MS = 2_000;
const DIAGNOSTIC_LIMIT_BYTES = 16 * 1024;
const now = () => new Date().toISOString();

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
	readonly readyTimeoutMs?: number;
	readonly gracefulShutdownMs?: number;
	readonly canonicalize?: (path: string) => Promise<string>;
}

interface LiveSession {
	readonly owner: WorkflowOwner;
	readonly id: string;
	readonly createdAt: string;
	updatedAt: string;
	readonly workflowName: string;
	readonly workflowPath: string;
	readonly projectPath: string;
	readonly historyPath: string;
	readonly process: SessionProcess;
	readonly events: EventHub<RuntimeEvent>;
	readonly unsubscribeRecord: () => void;
	readonly unsubscribeExit: () => void;
	diagnostic?: string;
}

type CloseReason = "stop" | "failure";

type WorkflowState =
	| { readonly state: "idle" }
	| {
			readonly state: "starting";
			readonly operation: Promise<StartSessionResult>;
	  }
	| { readonly state: "online"; readonly session: LiveSession }
	| {
			readonly state: "closing";
			readonly reason: CloseReason;
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
	private readonly options: SessionManagerOptions &
		Required<
			Pick<
				SessionManagerOptions,
				"readyTimeoutMs" | "gracefulShutdownMs" | "canonicalize"
			>
		>;

	constructor(options: SessionManagerOptions) {
		this.options = {
			...options,
			readyTimeoutMs: options.readyTimeoutMs ?? 10_000,
			gracefulShutdownMs: options.gracefulShutdownMs ?? 30_000,
			canonicalize: options.canonicalize ?? realpath,
		};
	}

	async recoverAfterRestart(): Promise<void> {
		await this.options.store.recoverAfterRestart();
	}

	private shutdownOptions(): SessionProcessShutdownOptions {
		return {
			gracefulMs: this.options.gracefulShutdownMs,
			terminateMs: TERMINATE_SHUTDOWN_MS,
			killMs: KILL_SHUTDOWN_MS,
		};
	}

	private summary(live: LiveSession, state?: SessionState): SessionSummary {
		const ownerState = live.owner.state;
		let actualState = state ?? "starting";
		if (state === undefined && ownerState.state === "online")
			actualState = "online";
		if (state === undefined && ownerState.state === "closing")
			actualState = ownerState.reason === "stop" ? "stopping" : "error";
		const summary: SessionSummary = {
			id: live.id,
			workflowKey: live.owner.workflowKey,
			workflowName: live.workflowName,
			workflowPath: live.workflowPath,
			workflowAliases: [...live.owner.aliases],
			projectPath: live.projectPath,
			state: actualState,
			createdAt: live.createdAt,
			updatedAt: live.updatedAt,
			historyPath: live.historyPath,
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
		for (const alias of [workflowKey, ...aliases]) {
			const conflict = this.workflows.get(alias);
			if (conflict !== undefined && conflict !== owner)
				throw new Error(`Conflicting Workflow lifecycle identity: ${alias}`);
			owner.aliases.add(alias);
			this.workflows.set(alias, owner);
		}
		return owner;
	}

	private release(owner: WorkflowOwner): void {
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
		const owner = this.ownerFor(await this.workflowKey(input), [alias]);
		for (;;) {
			if (!this.accepting) throw new SessionManagerShuttingDownError();
			const state = owner.state;
			if (state.state === "idle")
				return this.beginStart(owner, resolve(input.cwd));
			if (state.state === "starting") {
				const result = await state.operation;
				return { session: result.session, started: false };
			}
			if (state.state === "online") {
				state.session.updatedAt = now();
				const session = this.summary(state.session, "online");
				await this.options.store.upsert(session);
				return { session, started: false };
			}
			await state.operation.catch(() => undefined);
		}
	}

	private beginStart(
		owner: WorkflowOwner,
		projectPath: string,
	): Promise<StartSessionResult> {
		const operation = this.startSession(owner, projectPath).then(
			(live) => {
				owner.state = { state: "online", session: live };
				return { session: this.summary(live, "online"), started: true };
			},
			(error: unknown) => {
				owner.state = { state: "idle" };
				this.release(owner);
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
		const id = `session-${randomUUID()}`;
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
			diagnosticLimitBytes: DIAGNOSTIC_LIMIT_BYTES,
			commandTimeoutMs: COMMAND_TIMEOUT_MS,
		});
		const events = new EventHub<RuntimeEvent>(LIVE_EVENT_CAPACITY);
		const unsubscribeRecord = process.onRecord((record) => {
			if (record.kind === "event") events.publish(record.event);
		});
		const unsubscribeExit = process.onExit((error) => {
			const live = this.live.get(id);
			if (live?.process === process) void this.fail(live.owner, live, error);
		});
		let live: LiveSession | undefined;
		try {
			const ready = await process.waitUntilReady(this.options.readyTimeoutMs);
			const createdAt = now();
			live = {
				owner,
				id,
				createdAt,
				updatedAt: createdAt,
				workflowName: ready.workflowName,
				workflowPath: ready.workflowPath,
				projectPath: ready.projectPath,
				historyPath: ready.historyPath,
				process,
				events,
				unsubscribeRecord,
				unsubscribeExit,
			};
			this.live.set(id, live);
			await this.options.store.upsert(this.summary(live, "starting"));
			await process.command("start");
			live.updatedAt = now();
			await this.options.store.upsert(this.summary(live, "online"));
			return live;
		} catch (error) {
			if (live !== undefined) {
				live.diagnostic = this.appendDiagnostic(
					live.diagnostic,
					errorMessage(error),
				);
				live.updatedAt = now();
			}
			await process
				.shutdown({ ...this.shutdownOptions(), gracefulMs: 0 })
				.catch(() => undefined);
			if (live === undefined) {
				unsubscribeRecord();
				unsubscribeExit();
				events.close();
			} else {
				await this.options.store
					.upsert(this.summary(live, "error"))
					.catch(() => undefined);
				this.releaseLive(live);
			}
			throw error;
		}
	}

	private appendDiagnostic(current: string | undefined, value: string): string {
		const separator =
			current === undefined || current.endsWith("\n") ? "" : "\n";
		return trimDiagnostic(
			`${current ?? ""}${separator}${value}`,
			DIAGNOSTIC_LIMIT_BYTES,
		);
	}

	private releaseLive(live: LiveSession): void {
		live.unsubscribeRecord();
		live.unsubscribeExit();
		live.events.close();
		if (this.live.get(live.id) === live) this.live.delete(live.id);
	}

	private fail(
		owner: WorkflowOwner,
		live: LiveSession,
		error: unknown,
	): Promise<SessionSummary | undefined> {
		const state = owner.state;
		if (state.state === "closing" && state.session === live)
			return state.operation;
		if (state.state !== "online" || state.session !== live)
			return Promise.resolve(undefined);
		return this.beginClose(owner, live, "failure", error);
	}

	async find(path: string): Promise<SessionSummary | undefined> {
		const keys = await this.workflowLookupKeys(path);
		for (const key of keys) {
			const owner = this.workflows.get(key);
			if (owner?.state.state === "online")
				return this.summary(owner.state.session, "online");
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
		return live === undefined
			? this.options.store.get(id)
			: this.stopOwner(live.owner, id);
	}

	private async stopOwner(
		owner: WorkflowOwner,
		id?: string,
	): Promise<SessionSummary | undefined> {
		for (;;) {
			const state = owner.state;
			if (state.state === "idle") return;
			if (state.state === "starting") {
				try {
					await state.operation;
				} catch {
					return;
				}
				continue;
			}
			if (state.state === "closing")
				return id === undefined || state.session.id === id
					? state.operation
					: undefined;
			if (id !== undefined && state.session.id !== id) return;
			return this.beginClose(owner, state.session, "stop");
		}
	}

	private beginClose(
		owner: WorkflowOwner,
		live: LiveSession,
		reason: CloseReason,
		failure?: unknown,
	): Promise<SessionSummary> {
		const operation = this.closeLive(live, reason, failure).finally(() => {
			owner.state = { state: "idle" };
			this.release(owner);
		});
		owner.state = { state: "closing", reason, session: live, operation };
		return operation;
	}

	private async closeLive(
		live: LiveSession,
		reason: CloseReason,
		failure: unknown,
	): Promise<SessionSummary> {
		if (reason === "failure")
			live.diagnostic = this.appendDiagnostic(
				live.diagnostic,
				errorMessage(failure),
			);
		let shutdownFailure: unknown;
		try {
			const termination = await live.process.shutdown(this.shutdownOptions());
			if (termination.mode !== "graceful")
				live.diagnostic = this.appendDiagnostic(
					live.diagnostic,
					`Session worker shutdown mode: ${termination.mode}`,
				);
		} catch (error) {
			shutdownFailure = error;
			live.diagnostic = this.appendDiagnostic(
				live.diagnostic,
				errorMessage(error),
			);
		}
		live.updatedAt = now();
		const failed = reason === "failure" || shutdownFailure !== undefined;
		const summary = this.summary(live, failed ? "error" : "stopped");
		try {
			await this.options.store.upsert(summary);
		} finally {
			this.releaseLive(live);
		}
		if (reason === "stop" && shutdownFailure !== undefined)
			throw shutdownFailure;
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
		if (
			!this.accepting ||
			live === undefined ||
			live.owner.state.state !== "online" ||
			live.owner.state.session !== live
		)
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
