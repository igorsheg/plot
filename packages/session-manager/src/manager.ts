import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { basename, resolve } from "node:path";
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
} from "./session-process.js";
import { isActiveSession, type SessionSummary } from "./session.js";
import type { SessionStore } from "./session-store.js";

export interface StartWorkflow {
	readonly cwd: string;
	readonly workflowPath?: string;
}

export interface StartSessionResult {
	readonly session: SessionSummary;
	readonly started: boolean;
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
	readonly diagnosticLimitBytes?: number;
	readonly eventCapacity?: number;
	readonly canonicalize?: (path: string) => Promise<string>;
}

interface LiveSession {
	summary: SessionSummary;
	readonly process: SessionProcess;
	readonly events: EventHub<RuntimeEvent>;
	cleanup: () => void;
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
	private readonly starting = new Map<string, Promise<StartSessionResult>>();
	private readonly stopping = new Map<string, Promise<SessionSummary>>();
	private readonly options: Required<
		Pick<
			SessionManagerOptions,
			| "now"
			| "id"
			| "readyTimeoutMs"
			| "commandTimeoutMs"
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
			diagnosticLimitBytes: options.diagnosticLimitBytes ?? 16 * 1024,
			eventCapacity: options.eventCapacity ?? 1024,
			canonicalize: options.canonicalize ?? realpath,
		};
	}

	async recoverAfterRestart(): Promise<void> {
		await this.options.store.recoverAfterRestart();
	}

	private async workflowKey(input: StartWorkflow): Promise<string> {
		const path = resolveWorkflowPath(input);
		return this.options.canonicalize(path);
	}

	private async activeForWorkflow(
		workflowKey: string,
	): Promise<SessionSummary | undefined> {
		for (const live of this.live.values())
			if (live.summary.workflowKey === workflowKey) return live.summary;
		return (await this.options.store.list()).find(
			(session) =>
				session.workflowKey === workflowKey && isActiveSession(session),
		);
	}

	start(input: StartWorkflow): Promise<StartSessionResult> {
		return (async () => {
			const workflowKey = await this.workflowKey(input);
			const current = this.starting.get(workflowKey);
			if (current !== undefined) {
				const result = await current;
				return { session: result.session, started: false };
			}
			const start = (async () => {
				const existing = await this.activeForWorkflow(workflowKey);
				if (existing !== undefined)
					return { session: existing, started: false };
				return this.startSession(workflowKey, resolve(input.cwd));
			})();
			this.starting.set(workflowKey, start);
			try {
				return await start;
			} finally {
				this.starting.delete(workflowKey);
			}
		})();
	}

	private async startSession(
		workflowKey: string,
		projectPath: string,
	): Promise<StartSessionResult> {
		const sessionId = this.options.id();
		const child = (this.options.spawnChild ?? createSessionChildProcess)({
			command: this.options.cli.command,
			args: workerArgs({
				cliArgs: this.options.cli.args,
				cwd: projectPath,
				sessionId,
				workflowPath: workflowKey,
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
			workflowKey,
			workflowName: basename(workflowKey),
			workflowPath: workflowKey,
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
		const update = async (changes: Partial<SessionSummary>) => {
			live.summary = {
				...live.summary,
				...changes,
				updatedAt: this.options.now(),
			};
			await this.options.store.upsert(live.summary);
		};
		const unsubscribes = [
			process.onRecord((record) => {
				if (record.kind !== "event") return;
				events.publish(record.event);
				void update({ lastSequence: record.event.sequence }).catch((error) =>
					this.fail(live, error),
				);
			}),
			process.onDiagnostic((diagnostic) => {
				void update({ diagnostic }).catch((error) => this.fail(live, error));
			}),
			process.onExit((error) => {
				if (
					live.summary.state === "stopping" ||
					live.summary.state === "stopped"
				)
					return;
				void this.fail(live, error);
			}),
		];
		live.cleanup = () => unsubscribes.forEach((unsubscribe) => unsubscribe());
		this.live.set(sessionId, live);
		try {
			await this.options.store.upsert(summary);
			const ready = await process.waitUntilReady(this.options.readyTimeoutMs);
			await update({
				workflowName: ready.workflowName,
				workflowPath: ready.workflowPath,
				projectPath: ready.projectPath,
				historyPath: ready.historyPath,
			});
			await process.command("start");
			await update({ state: "online" });
			return { session: live.summary, started: true };
		} catch (error) {
			await this.fail(live, error);
			throw error;
		}
	}

	private async fail(live: LiveSession, error: unknown): Promise<void> {
		if (this.live.get(live.summary.id) !== live) return;
		const diagnostic = trimDiagnostic(
			`${live.summary.diagnostic ?? ""}${errorMessage(error)}`,
			this.options.diagnosticLimitBytes,
		);
		live.summary = {
			...live.summary,
			state: "error",
			updatedAt: this.options.now(),
			diagnostic,
		};
		await this.options.store.upsert(live.summary);
		live.process.kill("SIGTERM");
		live.cleanup();
		live.events.close();
		this.live.delete(live.summary.id);
	}

	async find(workflowPath: string): Promise<SessionSummary | undefined> {
		const workflowKey = await this.options.canonicalize(workflowPath);
		return this.activeForWorkflow(workflowKey);
	}

	async get(sessionId: string): Promise<SessionSummary | undefined> {
		return (
			this.live.get(sessionId)?.summary ?? this.options.store.get(sessionId)
		);
	}

	async stop(workflowPath: string): Promise<SessionSummary | undefined> {
		const session = await this.find(workflowPath);
		return session === undefined ? undefined : this.stopSession(session.id);
	}

	async stopSession(sessionId: string): Promise<SessionSummary | undefined> {
		const current = this.stopping.get(sessionId);
		if (current !== undefined) return current;
		const live = this.live.get(sessionId);
		if (live === undefined) return this.options.store.get(sessionId);
		const stopping = this.stopLiveSession(live);
		this.stopping.set(sessionId, stopping);
		try {
			return await stopping;
		} finally {
			this.stopping.delete(sessionId);
		}
	}

	private async stopLiveSession(live: LiveSession): Promise<SessionSummary> {
		live.summary = {
			...live.summary,
			state: "stopping",
			updatedAt: this.options.now(),
		};
		await this.options.store.upsert(live.summary);
		await live.process.command("shutdown").catch(() => undefined);
		live.process.kill("SIGTERM");
		live.cleanup();
		live.events.close();
		this.live.delete(live.summary.id);
		live.summary = {
			...live.summary,
			state: "stopped",
			updatedAt: this.options.now(),
		};
		await this.options.store.upsert(live.summary);
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
				if (session === undefined)
					throw new Error(`unknown Session: ${sessionId}`);
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

	private process(sessionId: string): SessionProcess {
		const live = this.live.get(sessionId);
		if (live === undefined)
			throw new Error(`Session is not active: ${sessionId}`);
		return live.process;
	}

	async tick(sessionId: string): Promise<void> {
		await this.process(sessionId).command("tick");
	}

	async pause(sessionId: string): Promise<void> {
		await this.process(sessionId).command("pause");
	}

	async resume(sessionId: string): Promise<void> {
		await this.process(sessionId).command("resume");
	}

	async interrupt(
		sessionId: string,
		input: InterruptAgentRunInput,
	): Promise<boolean> {
		return (await this.process(sessionId).command("interrupt", input)) === true;
	}

	async startSourceAction(
		sessionId: string,
		input: SourceActionInput,
	): Promise<SourceActionStartResult> {
		return (await this.process(sessionId).command(
			"source-action",
			input,
		)) as SourceActionStartResult;
	}

	async cancelSourceAction(
		sessionId: string,
		actionRunId: string,
	): Promise<boolean> {
		return (
			(await this.process(sessionId).command(
				"source-action-cancel",
				actionRunId,
			)) === true
		);
	}

	async observe(
		sessionId: string,
		input: OperatorObservationInput,
	): Promise<boolean> {
		return (await this.process(sessionId).command("observe", input)) === true;
	}

	async shutdown(): Promise<void> {
		await Promise.all([...this.live.keys()].map((id) => this.stopSession(id)));
	}
}
