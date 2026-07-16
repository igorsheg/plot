import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { BoundaryError } from "@plot/common/boundary-error";
import { EventHub } from "@plot/common/event-stream";
import { errorMessage } from "@plot/common/primitives";
import {
	createOwner,
	type Owner,
	type OwnedSession,
	type SessionCloseContext,
	type SessionIdentity,
	type SessionTarget,
} from "@plot/session/owner";
import type {
	OperatorObservationInput,
	RuntimeEvent,
	SourceActionInput,
	SourceActionStartResult,
} from "@plot/session/runtime";
import type { SessionWorkerAction } from "@plot/session/worker";
import {
	resolveWorkflowPath,
	type WorkflowDiscoveryOptions,
} from "@plot/session/workflow";
import { sessionEvents } from "./events.js";
import {
	SessionProcess,
	createSessionChildProcess,
	trimDiagnostic,
	type ProcessCommand,
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

export type StartWorkflow = WorkflowDiscoveryOptions;

export interface StartSessionResult {
	readonly session: SessionSummary;
	readonly started: boolean;
}

export type SessionControlOperation = Exclude<
	SessionWorkerAction,
	"start" | "shutdown"
>;

export class SessionNotFoundError extends BoundaryError {
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

export class SessionNotControllableError extends BoundaryError {
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

export class SessionManagerShuttingDownError extends BoundaryError {
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
	readonly cli: ProcessCommand;
	readonly spawnChild?: (
		input: ProcessCommand & { readonly cwd: string },
	) => SessionChildProcess;
	readonly readyTimeoutMs?: number;
	readonly gracefulShutdownMs?: number;
	readonly canonicalize?: (path: string) => Promise<string>;
}

interface LiveSession extends OwnedSession {
	readonly identity: SessionIdentity<string>;
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
	state: SessionState;
	diagnostic?: string;
}

interface ManagedSessionTarget {
	readonly projectPath: string;
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
	private readonly owner: Owner<string, ManagedSessionTarget, LiveSession>;
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
		this.owner = createOwner(
			({ target, identity }) =>
				this.createManagedSession(identity, target.projectPath),
			() => new SessionManagerShuttingDownError(),
		);
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

	private summary(live: LiveSession, state = live.state): SessionSummary {
		const summary: SessionSummary = {
			id: live.id,
			workflowKey: live.identity.key,
			workflowName: live.workflowName,
			workflowPath: live.workflowPath,
			workflowAliases: [...live.identity.aliases],
			projectPath: live.projectPath,
			state,
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

	private async workflowTarget(
		input: StartWorkflow,
	): Promise<SessionTarget<string, ManagedSessionTarget>> {
		const workflowPath = resolveWorkflowPath(input);
		return {
			key: await this.options.canonicalize(workflowPath),
			aliases: [resolve(workflowPath)],
			target: { projectPath: resolve(input.cwd) },
		};
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
		const result = await this.owner.start(await this.workflowTarget(input));
		if (!result.started) {
			result.session.updatedAt = now();
			await this.options.store.upsert(this.summary(result.session));
		}
		return {
			session: this.summary(result.session),
			started: result.started,
		};
	}

	private async createManagedSession(
		identity: SessionIdentity<string>,
		projectPath: string,
	): Promise<LiveSession> {
		const id = `session-${randomUUID()}`;
		const child = (this.options.spawnChild ?? createSessionChildProcess)({
			command: this.options.cli.command,
			args: workerArgs({
				cliArgs: this.options.cli.args,
				cwd: projectPath,
				sessionId: id,
				workflowPath: identity.key,
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
			if (live?.process === process)
				void this.owner.fail(live.identity, live, error);
		});
		let live: LiveSession | undefined;
		try {
			const ready = await process.waitUntilReady(this.options.readyTimeoutMs);
			const createdAt = now();
			live = {
				identity,
				id,
				state: "starting",
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
				close: async (context) => {
					if (live === undefined)
						throw new Error("Managed Session closed before creation");
					await this.closeLive(live, context);
				},
			};
			this.live.set(id, live);
			await this.options.store.upsert(this.summary(live, "starting"));
			await process.command("start");
			live.state = "online";
			live.updatedAt = now();
			await this.options.store.upsert(this.summary(live));
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
				live.state = "error";
				await this.options.store
					.upsert(this.summary(live))
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

	async find(path: string): Promise<SessionSummary | undefined> {
		const live = this.owner.find(await this.workflowLookupKeys(path));
		return live === undefined ? undefined : this.summary(live);
	}

	async get(id: string): Promise<SessionSummary | undefined> {
		const live = this.live.get(id);
		return live === undefined ? this.options.store.get(id) : this.summary(live);
	}

	async stop(path: string): Promise<SessionSummary | undefined> {
		const keys = await this.workflowLookupKeys(path);
		const stopped = await this.owner.stop(keys);
		if (stopped !== undefined) return this.summary(stopped);
		return (await this.options.store.list()).find(
			(session) =>
				keys.has(session.workflowKey) ||
				session.workflowAliases.some((alias) => keys.has(alias)),
		);
	}

	async stopSession(id: string): Promise<SessionSummary | undefined> {
		const live = this.live.get(id);
		if (live === undefined) return this.options.store.get(id);
		const stopped = await this.owner.stopOwned(live.identity, live);
		return stopped === undefined ? undefined : this.summary(stopped);
	}

	private async closeLive(
		live: LiveSession,
		context: SessionCloseContext,
	): Promise<void> {
		const failedByOwner = context.reason === "failure";
		live.state = failedByOwner ? "error" : "stopping";
		if (failedByOwner)
			live.diagnostic = this.appendDiagnostic(
				live.diagnostic,
				errorMessage(context.error),
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
		const failed = failedByOwner || shutdownFailure !== undefined;
		live.state = failed ? "error" : "stopped";
		const summary = this.summary(live);
		try {
			await this.options.store.upsert(summary);
		} finally {
			this.releaseLive(live);
		}
		if (!failedByOwner && shutdownFailure !== undefined) throw shutdownFailure;
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
		if (live === undefined || !this.owner.isControllable(live.identity, live))
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
		this.owner.stopAccepting();
		for (const live of this.live.values()) live.process.forceClose();
	}

	shutdown(): Promise<void> {
		return this.owner.dispose();
	}
}
