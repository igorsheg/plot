import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { EventHub } from "@plot/common/event-stream";
import { z } from "zod";
import { decodeServerRecordLine } from "./protocol-codec.js";
import {
	clientRequestSchema,
	defaultProtocolLimits,
	sessionProtocolVersion,
	type ClientRequest,
	type ServerRecord,
} from "./protocol.js";
import { jsonlLines, stringifyJsonl } from "./jsonl.js";
import { errorMessage } from "./primitives.js";
import { createFileEventLogStore } from "./event-log.js";

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

export interface RunChildProcess {
	readonly pid?: number;
	readonly stdout: AsyncIterable<string | Uint8Array>;
	readonly stderr: AsyncIterable<string | Uint8Array>;
	readonly write: (line: string) => Promise<void> | void;
	readonly kill: (signal?: NodeJS.Signals) => void;
	readonly exited: Promise<void>;
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
	readonly child: RunChildProcess;
	readonly events: EventHub<ServerRecord>;
	readonly pending: Map<
		string,
		{
			readonly resolve: (record: ServerRecord) => void;
			readonly reject: (error: Error) => void;
		}
	>;
}

const runArraySchema = z.array(runRecordSchema);
const textDecoder = () => new TextDecoder();

const clone = (record: RunRecord): RunRecord => ({
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
	id: `runRegistry_${command}_${randomUUID()}`,
	command,
	params: {},
});

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
	const args = ["api", "--stdio", "--cwd", options.cwd ?? process.cwd()];
	if (options.sessionId !== undefined)
		args.push("--session-id", options.sessionId);
	if (options.workflowPath !== undefined)
		args.push("--workflow", options.workflowPath);
	return args;
};

const defaultCli = () => {
	const script = process.argv[1];
	const isBun = basename(process.execPath) === "bun";
	return {
		command: process.execPath,
		args:
			isBun && script !== undefined && /\.[cm]?[jt]sx?$/.test(script)
				? [script]
				: [],
	};
};

const nodeChild = (input: {
	readonly command: string;
	readonly args: readonly string[];
	readonly cwd: string;
}): RunChildProcess => {
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
		if (isErrno(error, "ENOENT")) return [];
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

	private async consumeStdout(live: LiveRun): Promise<void> {
		for await (const record of childServerRecords(live.child.stdout)) {
			// eslint-disable-next-line no-await-in-loop -- child protocol records must update runRegistry state in order.
			await this.handleServerRecord(live, record);
		}
	}

	private async consumeStderr(live: LiveRun): Promise<void> {
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
		live: LiveRun,
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

	private async waitForWelcome(live: LiveRun): Promise<void> {
		const records = live.events.subscribe();
		let timeout: ReturnType<typeof setTimeout> | undefined;
		try {
			await Promise.race([
				(async () => {
					for await (const record of records) {
						if (record.kind !== "welcome") continue;
						return;
					}
					throw new Error("run closed before welcome");
				})(),
				new Promise<never>((_, reject) => {
					timeout = setTimeout(
						() => reject(new Error("run did not send welcome")),
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

	async spawn(input: RunSpawnOptions = {}): Promise<RunRecord> {
		const now = this.options.now();
		const cwd = input.cwd ?? this.options.cwd;
		const cli = this.options.cli ?? defaultCli();
		const args = [...cli.args, ...childArgs({ ...input, cwd })];
		const child = (this.options.spawnChild ?? nodeChild)({
			command: cli.command,
			args,
			cwd,
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
		const live: LiveRun = {
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

	private async markError(live: LiveRun, error: unknown): Promise<void> {
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

	private async handleExit(live: LiveRun): Promise<void> {
		if (this.live.get(live.record.id) !== live) return;
		if (live.record.status === "stopping" || live.record.status === "stopped")
			return;
		await this.markError(live, "run exited");
	}

	async stop(id: string): Promise<RunRecord | undefined> {
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
