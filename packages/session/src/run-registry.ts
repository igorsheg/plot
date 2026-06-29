import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { EventHub } from "@plot/common/event-stream";
import { errorMessage, hasErrnoCode, isRecord } from "@plot/common/primitives";
import { z } from "zod";
import {
	clientRequestSchema,
	sessionProtocolVersion,
	type ClientRequest,
	type ServerRecord,
} from "./protocol.js";
import { createFileEventLogStore } from "./event-log.js";
import {
	createRunChildProcess,
	RunProcessInstance,
	type RunChildProcess,
} from "./run-process.js";

type EventServerRecord = Extract<ServerRecord, { kind: "event" }>;

export const runStatusSchema = z.enum([
	"starting",
	"online",
	"stopping",
	"stopped",
	"error",
]);

export const runRecordSchema = z
	.object({
		id: z.string().min(1),
		status: runStatusSchema,
		cwd: z.string().min(1),
		cwdName: z.string().min(1).optional(),
		createdAt: z.string().min(1),
		lastSeenAt: z.string().min(1).optional(),
		label: z.string().min(1).optional(),
		pid: z.number().int().positive().optional(),
		sessionId: z.string().min(1).optional(),
		workflowName: z.string().min(1).optional(),
		workflowPath: z.string().min(1).optional(),
		sessionDir: z.string().min(1).optional(),
		eventLogPath: z.string().min(1).optional(),
		lastSequence: z.number().int().positive().optional(),
		lastEventType: z.string().min(1).optional(),
		stderrTail: z.string().optional(),
	})
	.strict();

export const runSpawnOptionsSchema = z
	.object({
		cwd: z.string().min(1).optional(),
		label: z.string().min(1).optional(),
		sessionId: z.string().min(1).optional(),
		workflowPath: z.string().min(1).optional(),
	})
	.strict();

export const runRequestSchema = z.discriminatedUnion("type", [
	z
		.object({
			type: z.literal("spawn"),
			options: runSpawnOptionsSchema.optional(),
		})
		.strict(),
	z.object({ type: z.literal("list") }).strict(),
	z.object({ type: z.literal("status"), id: z.string().min(1) }).strict(),
	z.object({ type: z.literal("stop"), id: z.string().min(1) }).strict(),
	z
		.object({
			type: z.literal("protocol_stream"),
			id: z.string().min(1),
			afterSequence: z.number().int().nonnegative().optional(),
		})
		.strict(),
	z
		.object({
			type: z.literal("protocol_request"),
			id: z.string().min(1),
			request: clientRequestSchema,
		})
		.strict(),
]);

export const runResponseSchema = z.discriminatedUnion("type", [
	z
		.object({
			type: z.literal("spawn_result"),
			ok: z.literal(true),
			run: runRecordSchema,
		})
		.strict(),
	z
		.object({
			type: z.literal("list_result"),
			ok: z.literal(true),
			runs: z.array(runRecordSchema),
		})
		.strict(),
	z
		.object({
			type: z.literal("status_result"),
			ok: z.literal(true),
			run: runRecordSchema.optional(),
		})
		.strict(),
	z
		.object({
			type: z.literal("stop_result"),
			ok: z.literal(true),
			id: z.string(),
			run: runRecordSchema.optional(),
		})
		.strict(),
	z
		.object({
			type: z.literal("protocol_ready"),
			ok: z.literal(true),
			run: runRecordSchema.optional(),
		})
		.strict(),
	z
		.object({ type: z.literal("protocol_response"), record: z.unknown() })
		.strict(),
	z
		.object({
			type: z.literal("error"),
			ok: z.literal(false),
			error: z.string(),
		})
		.strict(),
]);

export type RunStatus = z.infer<typeof runStatusSchema>;
export type RunRecord = z.infer<typeof runRecordSchema>;
export type RunSpawnOptions = z.infer<typeof runSpawnOptionsSchema>;
export type RunRequest = z.infer<typeof runRequestSchema>;
export type RunResponse = z.infer<typeof runResponseSchema>;

export interface RunStore {
	readonly list: () => Promise<readonly RunRecord[]>;
	readonly get: (id: string) => Promise<RunRecord | undefined>;
	readonly upsert: (record: RunRecord) => Promise<void>;
	readonly remove: (id: string) => Promise<void>;
	readonly recoverAfterRestart: () => Promise<void>;
}

export interface RunRegistryRuntime {
	readonly spawn: (input?: RunSpawnOptions) => Promise<RunRecord>;
	readonly stop: (id: string) => Promise<RunRecord | undefined>;
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
}

interface LiveRun {
	record: RunRecord;
	readonly process: RunProcessInstance;
	readonly events: EventHub<ServerRecord>;
	readonly cleanup: () => void;
}

const runArraySchema = z.array(runRecordSchema);

const clone = (record: RunRecord): RunRecord => ({
	...record,
});

const noop = () => {};

const trimTail = (value: string, maxBytes: number): string => {
	const bytes = new TextEncoder().encode(value);
	if (bytes.length <= maxBytes) return value;
	return new TextDecoder().decode(bytes.slice(bytes.length - maxBytes));
};

const makeRequest = (command: ClientRequest["command"]): ClientRequest => ({
	protocol: sessionProtocolVersion,
	kind: "request",
	id: `runRegistry_${command}_${randomUUID()}`,
	command,
	params: {},
});

const stateUpdates = (data: unknown): Partial<RunRecord> => {
	if (!isRecord(data)) return {};
	const updates: Partial<RunRecord> = {};
	for (const key of [
		"sessionId",
		"workflowName",
		"workflowPath",
		"cwdName",
		"sessionDir",
		"eventLogPath",
	] as const) {
		const value = data[key];
		if (typeof value === "string" && value.length > 0) updates[key] = value;
	}
	return updates;
};

async function* replayEventLogRecords(
	run: RunRecord,
	afterSequence: number,
): AsyncIterable<EventServerRecord> {
	if (run.sessionId === undefined || run.eventLogPath === undefined) return;
	const log = await createFileEventLogStore({
		sessionId: run.sessionId,
		sessionDir: dirname(dirname(run.eventLogPath)),
		path: run.eventLogPath,
	});
	let frontier = afterSequence;
	const read = await log.readAll();
	for (const event of read.records) {
		if (event.sequence <= frontier) continue;
		frontier = event.sequence;
		yield {
			protocol: sessionProtocolVersion,
			kind: "event",
			sequence: event.sequence,
			event,
		};
	}
}

async function* liveEventRecords(
	live: LiveRun,
	afterSequence: number,
): AsyncIterable<EventServerRecord> {
	let frontier = afterSequence;
	for await (const record of live.events.subscribe()) {
		if (record.kind !== "event" || record.sequence <= frontier) continue;
		frontier = record.sequence;
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

const stripTrailingNuls = (text: string): string => {
	let end = text.length;
	while (end > 0 && text.charCodeAt(end - 1) === 0) end--;
	return text.slice(0, end);
};

const parseRunStoreJson = (text: string): readonly RunRecord[] =>
	runArraySchema.parse(JSON.parse(stripTrailingNuls(text)) as unknown);

const readJson = async (path: string): Promise<readonly RunRecord[]> => {
	let text: string;
	try {
		text = await readFile(path, "utf8");
	} catch (error) {
		if (hasErrnoCode(error, "ENOENT")) return [];
		throw error;
	}
	try {
		return parseRunStoreJson(text);
	} catch (error) {
		const lastCompleteRecord = stripTrailingNuls(text).lastIndexOf("\n  }");
		if (lastCompleteRecord === -1) throw error;
		return parseRunStoreJson(`${text.slice(0, lastCompleteRecord + 4)}\n]\n`);
	}
};

export const createFileRunStore = (path: string): RunStore => {
	let pendingWrite: Promise<void> = Promise.resolve();
	const mutate = async (work: () => Promise<void>) => {
		const next = pendingWrite.then(work, work);
		pendingWrite = next.catch(() => undefined);
		await next;
	};
	const writeRecords = async (records: readonly RunRecord[]) => {
		await mkdir(dirname(path), { recursive: true });
		const tmp = `${path}.${process.pid}.tmp`;
		await writeFile(tmp, `${JSON.stringify(records, null, 2)}\n`);
		await rename(tmp, path);
	};
	return {
		list: async () => readJson(path),
		get: async (id) =>
			(await readJson(path)).find((record) => record.id === id),
		upsert: (record) =>
			mutate(async () => {
				const records = [...(await readJson(path))];
				const index = records.findIndex((item) => item.id === record.id);
				if (index === -1) records.push(record);
				else records[index] = record;
				await writeRecords(records);
			}),
		remove: (id) =>
			mutate(async () => {
				await writeRecords(
					(await readJson(path)).filter((record) => record.id !== id),
				);
			}),
		recoverAfterRestart: () =>
			mutate(async () => {
				const recoveredAt = new Date().toISOString();
				await writeRecords(
					(await readJson(path)).map((record) => ({
						...record,
						status:
							record.status === "online" || record.status === "starting"
								? "stopped"
								: record.status,
						lastSeenAt: recoveredAt,
					})),
				);
			}),
	};
};

export const createMemoryRunStore = (
	initial: readonly RunRecord[] = [],
): RunStore => {
	const records = new Map(initial.map((record) => [record.id, clone(record)]));
	return {
		list: async () => [...records.values()].map(clone),
		get: async (id) => {
			const record = records.get(id);
			return record === undefined ? undefined : clone(record);
		},
		upsert: async (record) => {
			records.set(record.id, clone(record));
		},
		remove: async (id) => {
			records.delete(id);
		},
		recoverAfterRestart: async () => {
			const lastSeenAt = new Date().toISOString();
			for (const [id, record] of records)
				records.set(id, {
					...record,
					status:
						record.status === "online" || record.status === "starting"
							? "stopped"
							: record.status,
					lastSeenAt,
				});
		},
	};
};

export const decodeRunRecord = (value: unknown): RunRecord =>
	runRecordSchema.parse(value);
export const decodeRunRequest = (value: unknown): RunRequest =>
	runRequestSchema.parse(value);
export const decodeRunResponse = (value: unknown): RunResponse =>
	runResponseSchema.parse(value);
export class RunRegistry implements RunRegistryRuntime {
	private readonly live = new Map<string, LiveRun>();
	private readonly options: Required<
		Pick<
			RunRegistryOptions,
			"now" | "id" | "spawnDeadlineMs" | "eventCapacity" | "stderrLimitBytes"
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
			record.command === "get_state"
		)
			await this.update(live, stateUpdates(record.data));
		if (record.kind === "event")
			await this.update(live, {
				lastSequence: record.sequence,
				lastEventType:
					record.event.kind === "session_event"
						? record.event.type
						: "agent_event",
			});
		live.events.publish(record);
	}

	async recoverAfterRestart(): Promise<void> {
		await this.options.store.recoverAfterRestart();
	}

	async spawn(input: RunSpawnOptions = {}): Promise<RunRecord> {
		const now = this.options.now();
		const cwd = input.cwd ?? this.options.cwd;
		const cli = this.options.cli;
		if (cli === undefined && this.options.spawnChild === undefined)
			throw new Error("run registry needs a CLI command to spawn runs");
		const args = [...(cli?.args ?? []), ...childArgs({ ...input, cwd })];
		const child = (this.options.spawnChild ?? createRunChildProcess)({
			command: cli?.command ?? "plot-test",
			args,
			cwd,
		});
		const process = new RunProcessInstance(child, {
			stderrLimitBytes: this.options.stderrLimitBytes,
		});
		const record = runRecordSchema.parse({
			id: this.options.id(),
			status: "starting",
			cwd,
			cwdName: basename(cwd),
			createdAt: now,
			lastSeenAt: now,
			...(input.label === undefined ? {} : { label: input.label }),
			...(child.pid === undefined ? {} : { pid: child.pid }),
			...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
			...(input.workflowPath === undefined
				? {}
				: { workflowPath: input.workflowPath }),
		});
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
			await this.send(live, makeRequest("start"));
			await this.syncRunRecord(live);
			await this.setStatus(live, "online");
			return clone(live.record);
		} catch (error) {
			await this.markError(live, error);
			throw error;
		}
	}

	private async syncRunRecord(live: LiveRun): Promise<void> {
		const record = await this.send(live, makeRequest("get_state"));
		if (
			record.kind === "response" &&
			record.ok &&
			record.command === "get_state"
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
		await this.send(live, makeRequest("shutdown")).catch(() => undefined);
		live.process.kill("SIGTERM");
		live.cleanup();
		live.events.close();
		this.live.delete(id);
		await this.update(live, { status: "stopped" });
		return clone(live.record);
	}

	async list(): Promise<readonly RunRecord[]> {
		const records = new Map(
			(await this.options.store.list()).map((item) => [item.id, item]),
		);
		for (const live of this.live.values())
			records.set(live.record.id, live.record);
		return [...records.values()].map(clone);
	}

	async status(id: string): Promise<RunRecord | undefined> {
		const live = this.live.get(id);
		return live === undefined ? this.options.store.get(id) : clone(live.record);
	}

	async *attachRecords(
		id: string,
		afterSequence = 0,
	): AsyncIterable<ServerRecord> {
		const live = this.live.get(id);
		const run = live?.record ?? (await this.options.store.get(id));
		if (run === undefined) return;
		let frontier = afterSequence;
		for await (const record of replayEventLogRecords(run, frontier)) {
			frontier = record.sequence;
			yield record;
		}
		if (live !== undefined) yield* liveEventRecords(live, frontier);
	}

	submit(id: string, request: ClientRequest): Promise<ServerRecord> {
		const live = this.live.get(id);
		if (live === undefined) throw new Error(`unknown run: ${id}`);
		return this.send(live, request);
	}

	async shutdown(): Promise<void> {
		await Promise.all([...this.live.keys()].map((id) => this.stop(id)));
	}
}
