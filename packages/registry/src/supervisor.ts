import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { EventHub } from "@plot/common/event-stream";
import { errorMessage, isRecord } from "@plot/common/primitives";
import {
	sessionProtocolVersion,
	type ClientRequest,
	type ServerRecord,
} from "@plot/session/protocol";
import type { RunRecord, RunStatus } from "./record.js";
import {
	RunProcessInstance,
	createRunChildProcess,
	trimTail,
	type RunChildProcess,
} from "./run-process.js";
import type { RunStore } from "./store.js";

export interface RunSpawnOptions {
	readonly cwd?: string;
	readonly label?: string;
	readonly sessionId?: string;
	readonly workflowPath?: string;
}

export interface RunRegistryRuntime {
	readonly spawn: (input?: RunSpawnOptions) => Promise<RunRecord>;
	readonly stop: (id: string) => Promise<RunRecord | undefined>;
	readonly prune: () => Promise<readonly RunRecord[]>;
	readonly list: () => Promise<readonly RunRecord[]>;
	readonly status: (id: string) => Promise<RunRecord | undefined>;
	readonly attachRecords: (
		id: string,
		afterSequence?: number,
	) => AsyncIterable<ServerRecord>;
	readonly submit: (
		id: string,
		request: ClientRequest,
	) => Promise<ServerRecord>;
	readonly shutdown: () => Promise<void>;
}

export interface RunRegistryOptions {
	readonly cwd: string;
	readonly store: RunStore;
	readonly cli?: { readonly command: string; readonly args: readonly string[] };
	readonly spawnChild?: (input: {
		readonly command: string;
		readonly args: readonly string[];
		readonly cwd: string;
	}) => RunChildProcess;
	readonly now?: () => string;
	readonly id?: () => string;
	readonly spawnDeadlineMs?: number;
	readonly eventCapacity?: number;
	readonly stderrLimitBytes?: number;
	readonly requestTimeoutMs?: number;
}

interface LiveRun {
	record: RunRecord;
	readonly process: RunProcessInstance;
	readonly events: EventHub<ServerRecord>;
	readonly cleanup: () => void;
}

const noop = () => {};

const makeRequest = (method: ClientRequest["method"]): ClientRequest => ({
	protocol: sessionProtocolVersion,
	kind: "request",
	id: `runRegistry_${method.replaceAll(".", "_")}_${randomUUID()}`,
	method,
	params: {},
});

const stateUpdates = (data: unknown): Partial<RunRecord> => {
	if (!isRecord(data)) return {};
	const updates: {
		sessionId?: string;
		workflowName?: string;
		workflowPath?: string;
		cwdName?: string;
		sessionFile?: string;
	} = {};
	for (const key of [
		"sessionId",
		"workflowName",
		"workflowPath",
		"cwdName",
		"sessionFile",
	] as const) {
		const value = data[key];
		if (typeof value === "string" && value.length > 0) updates[key] = value;
	}
	return updates;
};

async function* liveEventRecords(
	live: LiveRun,
	afterSequence: number,
): AsyncIterable<ServerRecord> {
	let frontier = afterSequence;
	for await (const record of live.events.subscribe()) {
		if (record.kind !== "event" || record.event.sequence <= frontier) continue;
		frontier = record.event.sequence;
		yield record;
	}
}

const childArgs = (options: RunSpawnOptions): readonly string[] => {
	const args = ["__internal-api-stdio", "--cwd", options.cwd ?? process.cwd()];
	if (options.sessionId !== undefined)
		args.push("--session-id", options.sessionId);
	if (options.workflowPath !== undefined)
		args.push("--workflow", options.workflowPath);
	return args;
};

export class RunRegistry implements RunRegistryRuntime {
	private readonly live = new Map<string, LiveRun>();
	private readonly options: Required<
		Pick<
			RunRegistryOptions,
			| "now"
			| "id"
			| "spawnDeadlineMs"
			| "eventCapacity"
			| "stderrLimitBytes"
			| "requestTimeoutMs"
		>
	> &
		RunRegistryOptions;

	constructor(options: RunRegistryOptions) {
		this.options = {
			...options,
			now: options.now ?? (() => new Date().toISOString()),
			id: options.id ?? randomUUID,
			spawnDeadlineMs: options.spawnDeadlineMs ?? 10_000,
			eventCapacity: options.eventCapacity ?? 1024,
			stderrLimitBytes: options.stderrLimitBytes ?? 16 * 1024,
			requestTimeoutMs: options.requestTimeoutMs ?? 30_000,
		};
	}

	private async update(live: LiveRun, updates: Partial<RunRecord>) {
		live.record = {
			...live.record,
			...updates,
			lastSeenAt: this.options.now(),
		};
		await this.options.store.upsert(live.record);
	}

	private async setStatus(live: LiveRun, status: RunStatus) {
		await this.update(live, { status });
	}

	private send(live: LiveRun, request: ClientRequest): Promise<ServerRecord> {
		return live.process.send(request);
	}

	private handleProcessRecord(live: LiveRun, record: ServerRecord): void {
		void this.applyServerRecord(live, record).catch((error) =>
			this.markError(live, error),
		);
	}

	private async applyServerRecord(
		live: LiveRun,
		record: ServerRecord,
	): Promise<void> {
		if (record.kind === "welcome")
			await this.update(live, { sessionId: record.sessionId });
		if (
			record.kind === "response" &&
			record.ok &&
			record.method === "session.snapshot"
		)
			await this.update(live, stateUpdates(record.data));
		if (record.kind === "event") {
			await this.update(live, {
				lastSequence: record.event.sequence,
				lastEventType:
					record.event.kind === "session_event"
						? record.event.event.type
						: "agent_event",
			});
		}
		live.events.publish(record);
	}

	async recoverAfterRestart(): Promise<void> {
		await this.options.store.recoverAfterRestart();
	}

	async spawn(input: RunSpawnOptions = {}): Promise<RunRecord> {
		const now = this.options.now();
		const cwd = input.cwd ?? this.options.cwd;
		const cli = this.options.cli;
		const args = [...(cli?.args ?? []), ...childArgs({ ...input, cwd })];
		const child = (this.options.spawnChild ?? createRunChildProcess)({
			command: cli?.command ?? "plot-test",
			args,
			cwd,
		});
		const process = new RunProcessInstance(child, {
			stderrLimitBytes: this.options.stderrLimitBytes,
			requestTimeoutMs: this.options.requestTimeoutMs,
		});
		const record = {
			id: this.options.id(),
			status: "starting",
			cwd,
			cwdName: basename(cwd),
			createdAt: now,
			lastSeenAt: now,
			label: input.label,
			pid: child.pid,
			sessionId: input.sessionId,
			workflowPath: input.workflowPath,
		} as RunRecord;
		const events = new EventHub<ServerRecord>(this.options.eventCapacity);
		let cleanup: () => void = noop;
		const live: LiveRun = {
			record,
			process,
			events,
			cleanup: () => cleanup(),
		};
		const unsubscribes = [
			process.onRecord((serverRecord) =>
				this.handleProcessRecord(live, serverRecord),
			),
			process.onStderrTail((stderrTail) => {
				void this.update(live, { stderrTail }).catch((error) =>
					this.markError(live, error),
				);
			}),
			process.onExit((error) => {
				void this.handleExit(live, error);
			}),
		];
		cleanup = () => unsubscribes.forEach((unsubscribe) => unsubscribe());
		this.live.set(record.id, live);
		await this.options.store.upsert(record);
		try {
			await process.waitForWelcome(this.options.spawnDeadlineMs);
			await this.send(live, makeRequest("session.start"));
			await this.syncRunRecord(live);
			await this.setStatus(live, "online");
			return live.record;
		} catch (error) {
			await this.markError(live, error);
			throw error;
		}
	}

	private async syncRunRecord(live: LiveRun): Promise<void> {
		const record = await this.send(live, makeRequest("session.snapshot"));
		if (
			record.kind === "response" &&
			record.ok &&
			record.method === "session.snapshot"
		)
			await this.update(live, stateUpdates(record.data));
	}

	private async markError(live: LiveRun, error: unknown): Promise<void> {
		if (this.live.get(live.record.id) !== live) return;
		await this.update(live, {
			status: "error",
			stderrTail: trimTail(
				`${live.record.stderrTail ?? ""}${errorMessage(error)}`,
				this.options.stderrLimitBytes,
			),
		});
		live.process.kill("SIGTERM");
		live.cleanup();
		live.events.close();
		this.live.delete(live.record.id);
	}

	private async handleExit(live: LiveRun, error?: Error): Promise<void> {
		if (this.live.get(live.record.id) !== live) return;
		if (live.record.status === "stopping" || live.record.status === "stopped")
			return;
		await this.markError(live, error ?? "run exited");
	}

	async stop(id: string): Promise<RunRecord | undefined> {
		const live = this.live.get(id);
		if (live === undefined) return this.options.store.get(id);
		await this.setStatus(live, "stopping");
		await this.send(live, makeRequest("session.shutdown")).catch(
			() => undefined,
		);
		live.process.kill("SIGTERM");
		live.cleanup();
		live.events.close();

		this.live.delete(id);
		await this.update(live, { status: "stopped" });
		return live.record;
	}

	async list(): Promise<readonly RunRecord[]> {
		const records = new Map(
			(await this.options.store.list()).map((item) => [item.id, item]),
		);
		for (const live of this.live.values())
			records.set(live.record.id, live.record);
		return [...records.values()];
	}

	async status(id: string): Promise<RunRecord | undefined> {
		const live = this.live.get(id);
		return live === undefined ? this.options.store.get(id) : live.record;
	}

	async *attachRecords(
		id: string,
		afterSequence = 0,
	): AsyncIterable<ServerRecord> {
		const live = this.live.get(id);
		if (live === undefined) return;
		yield* liveEventRecords(live, afterSequence);
	}

	submit(id: string, request: ClientRequest): Promise<ServerRecord> {
		const live = this.live.get(id);
		if (live === undefined) throw new Error(`unknown run: ${id}`);
		return this.send(live, request);
	}

	async shutdown(): Promise<void> {
		await Promise.all([...this.live.keys()].map((id) => this.stop(id)));
	}

	/** Remove ended run records; live runs stay. */
	async prune(): Promise<readonly RunRecord[]> {
		const ended = (await this.options.store.list()).filter((record) => {
			if (this.live.has(record.id)) return false;
			return record.status === "stopped" || record.status === "error";
		});
		await Promise.all(
			ended.map((record) => this.options.store.remove(record.id)),
		);
		return ended;
	}
}
