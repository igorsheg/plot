import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { EventHub } from "@plot/common/event-stream";
import { z } from "zod";
import { decodeServerRecordLine } from "./protocol-codec.js";
import {
	defaultProtocolLimits,
	sessionProtocolVersion,
	type ClientRequest,
	type ServerRecord,
} from "./protocol.js";
import { jsonlLines, stringifyJsonl } from "./jsonl.js";
import { errorMessage } from "./primitives.js";
import { createFileEventLogStore } from "./event-log.js";

type EventServerRecord = Extract<ServerRecord, { kind: "event" }>;

export const fleetInstanceStatusSchema = z.enum([
	"starting",
	"online",
	"stopping",
	"stopped",
	"error",
]);

export const fleetInstanceRecordSchema = z
	.object({
		id: z.string().min(1),
		status: fleetInstanceStatusSchema,
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

export const fleetSpawnOptionsSchema = z
	.object({
		cwd: z.string().min(1).optional(),
		label: z.string().min(1).optional(),
		sessionId: z.string().min(1).optional(),
		workflowPath: z.string().min(1).optional(),
	})
	.strict();

export const fleetRequestSchema = z.discriminatedUnion("type", [
	z
		.object({
			type: z.literal("spawn"),
			options: fleetSpawnOptionsSchema.optional(),
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
]);

export const fleetResponseSchema = z.discriminatedUnion("type", [
	z
		.object({
			type: z.literal("spawn_result"),
			ok: z.literal(true),
			instance: fleetInstanceRecordSchema,
		})
		.strict(),
	z
		.object({
			type: z.literal("list_result"),
			ok: z.literal(true),
			instances: z.array(fleetInstanceRecordSchema),
		})
		.strict(),
	z
		.object({
			type: z.literal("status_result"),
			ok: z.literal(true),
			instance: fleetInstanceRecordSchema,
		})
		.strict(),
	z
		.object({
			type: z.literal("stop_result"),
			ok: z.literal(true),
			id: z.string(),
		})
		.strict(),
	z
		.object({
			type: z.literal("protocol_ready"),
			ok: z.literal(true),
			instance: fleetInstanceRecordSchema,
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

export type FleetInstanceStatus = z.infer<typeof fleetInstanceStatusSchema>;
export type FleetInstanceRecord = z.infer<typeof fleetInstanceRecordSchema>;
export type FleetSpawnOptions = z.infer<typeof fleetSpawnOptionsSchema>;
export type FleetRequest = z.infer<typeof fleetRequestSchema>;
export type FleetResponse = z.infer<typeof fleetResponseSchema>;

export interface FleetStore {
	readonly list: () => Promise<readonly FleetInstanceRecord[]>;
	readonly get: (id: string) => Promise<FleetInstanceRecord | undefined>;
	readonly upsert: (record: FleetInstanceRecord) => Promise<void>;
	readonly remove: (id: string) => Promise<void>;
	readonly recoverAfterRestart: () => Promise<void>;
}

export interface FleetRuntime {
	readonly spawn: (input?: FleetSpawnOptions) => Promise<FleetInstanceRecord>;
	readonly stop: (id: string) => Promise<FleetInstanceRecord | undefined>;
	readonly list: () => Promise<readonly FleetInstanceRecord[]>;
	readonly status: (id: string) => Promise<FleetInstanceRecord | undefined>;
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

export interface FleetChildProcess {
	readonly pid?: number;
	readonly stdout: AsyncIterable<string | Uint8Array>;
	readonly stderr: AsyncIterable<string | Uint8Array>;
	readonly write: (line: string) => Promise<void> | void;
	readonly kill: (signal?: NodeJS.Signals) => void;
	readonly exited: Promise<void>;
}

export interface FleetOptions {
	readonly cwd: string;
	readonly store: FleetStore;
	readonly cli?: { readonly command: string; readonly args: readonly string[] };
	readonly spawnChild?: (input: {
		readonly command: string;
		readonly args: readonly string[];
		readonly cwd: string;
	}) => FleetChildProcess;
	readonly now?: () => string;
	readonly id?: () => string;
	readonly spawnDeadlineMs?: number;
	readonly eventCapacity?: number;
	readonly stderrLimitBytes?: number;
}

interface LiveInstance {
	record: FleetInstanceRecord;
	readonly child: FleetChildProcess;
	readonly events: EventHub<ServerRecord>;
	readonly pending: Map<
		string,
		{
			readonly resolve: (record: ServerRecord) => void;
			readonly reject: (error: Error) => void;
		}
	>;
}

const instanceArraySchema = z.array(fleetInstanceRecordSchema);
const textDecoder = () => new TextDecoder();

const clone = (record: FleetInstanceRecord): FleetInstanceRecord => ({
	...record,
});

const isErrno = (error: unknown, code: string): boolean =>
	typeof error === "object" &&
	error !== null &&
	"code" in error &&
	(error as { readonly code?: unknown }).code === code;

async function* emptyAsyncIterable(): AsyncIterable<string | Uint8Array> {}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const decodeText = (decoder: TextDecoder, chunk: string | Uint8Array): string =>
	typeof chunk === "string" ? chunk : decoder.decode(chunk);

async function* childServerRecords(
	stdout: AsyncIterable<string | Uint8Array>,
): AsyncIterable<ServerRecord> {
	for await (const line of jsonlLines(stdout, {
		maxLineBytes: defaultProtocolLimits.maxInputLineBytes,
	})) {
		const trimmed = line.trim();
		if (trimmed !== "") yield decodeServerRecordLine(trimmed);
	}
}

const trimTail = (value: string, maxBytes: number): string => {
	const bytes = new TextEncoder().encode(value);
	if (bytes.length <= maxBytes) return value;
	return new TextDecoder().decode(bytes.slice(bytes.length - maxBytes));
};

const makeRequest = (command: ClientRequest["command"]): ClientRequest => ({
	protocol: sessionProtocolVersion,
	kind: "request",
	id: `fleet_${command}_${randomUUID()}`,
	command,
	params: {},
});

async function* replayEventLogRecords(
	instance: FleetInstanceRecord,
	afterSequence: number,
): AsyncIterable<EventServerRecord> {
	if (instance.sessionId === undefined || instance.eventLogPath === undefined)
		return;
	const log = await createFileEventLogStore({
		sessionId: instance.sessionId,
		sessionDir: dirname(dirname(instance.eventLogPath)),
		path: instance.eventLogPath,
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
	live: LiveInstance,
	afterSequence: number,
): AsyncIterable<EventServerRecord> {
	let frontier = afterSequence;
	for await (const record of live.events.subscribe()) {
		if (record.kind !== "event" || record.sequence <= frontier) continue;
		frontier = record.sequence;
		yield record;
	}
}

const childArgs = (options: FleetSpawnOptions): readonly string[] => {
	const args = ["serve", "stdio", "--cwd", options.cwd ?? process.cwd()];
	if (options.sessionId !== undefined)
		args.push("--session-id", options.sessionId);
	if (options.workflowPath !== undefined)
		args.push("--workflow", options.workflowPath);
	return args;
};

const defaultCli = () => ({
	command: process.execPath,
	args: process.argv[1] === undefined ? [] : [process.argv[1]],
});

const nodeChild = (input: {
	readonly command: string;
	readonly args: readonly string[];
	readonly cwd: string;
}): FleetChildProcess => {
	const child: ChildProcess = spawn(input.command, [...input.args], {
		cwd: input.cwd,
		stdio: ["pipe", "pipe", "pipe"],
	});
	return {
		...(child.pid === undefined ? {} : { pid: child.pid }),
		stdout: child.stdout ?? emptyAsyncIterable(),
		stderr: child.stderr ?? emptyAsyncIterable(),
		write: (line) =>
			new Promise<void>((resolveWrite, rejectWrite) => {
				child.stdin?.write(line, (error) => {
					if (error === undefined) resolveWrite();
					else rejectWrite(error);
				});
			}),
		kill: (signal) => {
			child.kill(signal);
		},
		exited: new Promise((resolveExit) => {
			child.once("exit", () => resolveExit());
			child.once("error", () => resolveExit());
		}),
	};
};

const encodeClientRequestLine = (request: ClientRequest): string =>
	stringifyJsonl(request, { maxLineBytes: 1024 * 1024 });

const readJson = async (
	path: string,
): Promise<readonly FleetInstanceRecord[]> => {
	let text: string;
	try {
		text = await readFile(path, "utf8");
	} catch (error) {
		if (isErrno(error, "ENOENT")) return [];
		throw error;
	}
	return instanceArraySchema.parse(JSON.parse(text) as unknown);
};

export const createFileFleetStore = (path: string): FleetStore => {
	const writeRecords = async (records: readonly FleetInstanceRecord[]) => {
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, `${JSON.stringify(records, null, 2)}\n`);
	};
	return {
		list: async () => readJson(path),
		get: async (id) =>
			(await readJson(path)).find((record) => record.id === id),
		upsert: async (record) => {
			const records = [...(await readJson(path))];
			const index = records.findIndex((item) => item.id === record.id);
			if (index === -1) records.push(record);
			else records[index] = record;
			await writeRecords(records);
		},
		remove: async (id) => {
			await writeRecords(
				(await readJson(path)).filter((record) => record.id !== id),
			);
		},
		recoverAfterRestart: async () => {
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
		},
	};
};

export const createMemoryFleetStore = (
	initial: readonly FleetInstanceRecord[] = [],
): FleetStore => {
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

export const decodeFleetInstanceRecord = (
	value: unknown,
): FleetInstanceRecord => fleetInstanceRecordSchema.parse(value);
export const decodeFleetRequest = (value: unknown): FleetRequest =>
	fleetRequestSchema.parse(value);
export const decodeFleetResponse = (value: unknown): FleetResponse =>
	fleetResponseSchema.parse(value);
export class Fleet implements FleetRuntime {
	private readonly live = new Map<string, LiveInstance>();
	private readonly options: Required<
		Pick<
			FleetOptions,
			"now" | "id" | "spawnDeadlineMs" | "eventCapacity" | "stderrLimitBytes"
		>
	> &
		FleetOptions;

	constructor(options: FleetOptions) {
		this.options = {
			...options,
			now: options.now ?? (() => new Date().toISOString()),
			id: options.id ?? randomUUID,
			spawnDeadlineMs: options.spawnDeadlineMs ?? 10_000,
			eventCapacity: options.eventCapacity ?? 1024,
			stderrLimitBytes: options.stderrLimitBytes ?? 16 * 1024,
		};
	}

	private async update(
		live: LiveInstance,
		updates: Partial<FleetInstanceRecord>,
	) {
		live.record = {
			...live.record,
			...updates,
			lastSeenAt: this.options.now(),
		};
		await this.options.store.upsert(live.record);
	}

	private async setStatus(live: LiveInstance, status: FleetInstanceStatus) {
		await this.update(live, { status });
	}

	private send(
		live: LiveInstance,
		request: ClientRequest,
	): Promise<ServerRecord> {
		return new Promise((resolve, reject) => {
			live.pending.set(request.id, { resolve, reject });
			Promise.resolve(live.child.write(encodeClientRequestLine(request))).catch(
				(error: unknown) => {
					live.pending.delete(request.id);
					reject(error instanceof Error ? error : new Error(String(error)));
				},
			);
		});
	}

	private async consumeStdout(live: LiveInstance): Promise<void> {
		for await (const record of childServerRecords(live.child.stdout)) {
			// eslint-disable-next-line no-await-in-loop -- child protocol records must update fleet state in order.
			await this.handleServerRecord(live, record);
		}
	}

	private async consumeStderr(live: LiveInstance): Promise<void> {
		const decoder = textDecoder();
		let stderrTail = live.record.stderrTail ?? "";
		for await (const chunk of live.child.stderr) {
			stderrTail = trimTail(
				`${stderrTail}${decodeText(decoder, chunk)}`,
				this.options.stderrLimitBytes,
			);
			await this.update(live, { stderrTail });
		}
	}

	private async handleServerRecord(
		live: LiveInstance,
		record: ServerRecord,
	): Promise<void> {
		if (record.kind === "welcome")
			await this.update(live, { sessionId: record.sessionId });
		if (
			record.kind === "response" &&
			record.ok &&
			record.command === "get_state" &&
			isRecord(record.data) &&
			typeof record.data["sessionId"] === "string"
		)
			await this.update(live, { sessionId: record.data["sessionId"] });
		if (record.kind === "response" && typeof record.id === "string") {
			live.pending.get(record.id)?.resolve(record);
			live.pending.delete(record.id);
		}
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

	private async waitForWelcome(live: LiveInstance): Promise<void> {
		const records = live.events.subscribe();
		let timeout: ReturnType<typeof setTimeout> | undefined;
		try {
			await Promise.race([
				(async () => {
					for await (const record of records) {
						if (record.kind !== "welcome") continue;
						return;
					}
					throw new Error("instance closed before welcome");
				})(),
				new Promise<never>((_, reject) => {
					timeout = setTimeout(
						() => reject(new Error("instance did not send welcome")),
						this.options.spawnDeadlineMs,
					);
				}),
			]);
		} finally {
			if (timeout !== undefined) clearTimeout(timeout);
		}
	}

	async recoverAfterRestart(): Promise<void> {
		await this.options.store.recoverAfterRestart();
	}

	async spawn(input: FleetSpawnOptions = {}): Promise<FleetInstanceRecord> {
		const now = this.options.now();
		const cwd = input.cwd ?? this.options.cwd;
		const cli = this.options.cli ?? defaultCli();
		const args = [...cli.args, ...childArgs({ ...input, cwd })];
		const child = (this.options.spawnChild ?? nodeChild)({
			command: cli.command,
			args,
			cwd,
		});
		const record = fleetInstanceRecordSchema.parse({
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
		const live: LiveInstance = {
			record,
			child,
			events: new EventHub<ServerRecord>(this.options.eventCapacity),
			pending: new Map(),
		};
		this.live.set(record.id, live);
		await this.options.store.upsert(record);
		void this.consumeStdout(live).catch((error) => this.markError(live, error));
		void this.consumeStderr(live).catch((error) => this.markError(live, error));
		void child.exited.then(() => this.handleExit(live));
		try {
			await this.waitForWelcome(live);
			await this.send(live, makeRequest("start"));
			await this.setStatus(live, "online");
			return clone(live.record);
		} catch (error) {
			await this.markError(live, error);
			throw error;
		}
	}

	private async markError(live: LiveInstance, error: unknown): Promise<void> {
		if (this.live.get(live.record.id) !== live) return;
		await this.update(live, {
			status: "error",
			stderrTail: trimTail(
				`${live.record.stderrTail ?? ""}${errorMessage(error)}`,
				this.options.stderrLimitBytes,
			),
		});
		for (const pending of live.pending.values())
			pending.reject(error instanceof Error ? error : new Error(String(error)));
		live.pending.clear();
		live.events.close();
		this.live.delete(live.record.id);
	}

	private async handleExit(live: LiveInstance): Promise<void> {
		if (this.live.get(live.record.id) !== live) return;
		if (live.record.status === "stopping" || live.record.status === "stopped")
			return;
		await this.markError(live, "instance exited");
	}

	async stop(id: string): Promise<FleetInstanceRecord | undefined> {
		const live = this.live.get(id);
		if (live === undefined) return this.options.store.get(id);
		await this.setStatus(live, "stopping");
		await this.send(live, makeRequest("shutdown")).catch(() => undefined);
		live.child.kill("SIGTERM");
		live.events.close();
		this.live.delete(id);
		await this.update(live, { status: "stopped" });
		return clone(live.record);
	}

	async list(): Promise<readonly FleetInstanceRecord[]> {
		const records = new Map(
			(await this.options.store.list()).map((item) => [item.id, item]),
		);
		for (const live of this.live.values())
			records.set(live.record.id, live.record);
		return [...records.values()].map(clone);
	}

	async status(id: string): Promise<FleetInstanceRecord | undefined> {
		const live = this.live.get(id);
		return live === undefined ? this.options.store.get(id) : clone(live.record);
	}

	async *attachRecords(
		id: string,
		afterSequence = 0,
	): AsyncIterable<ServerRecord> {
		const live = this.live.get(id);
		const instance = live?.record ?? (await this.options.store.get(id));
		if (instance === undefined) return;
		let frontier = afterSequence;
		for await (const record of replayEventLogRecords(instance, frontier)) {
			frontier = record.sequence;
			yield record;
		}
		if (live !== undefined) yield* liveEventRecords(live, frontier);
	}

	submit(id: string, request: ClientRequest): Promise<ServerRecord> {
		const live = this.live.get(id);
		if (live === undefined) throw new Error(`unknown instance: ${id}`);
		return this.send(live, request);
	}

	async shutdown(): Promise<void> {
		await Promise.all([...this.live.keys()].map((id) => this.stop(id)));
	}
}
