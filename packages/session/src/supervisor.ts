import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { open } from "node:fs/promises";
import { dirname, join } from "node:path";
import { EventHub } from "@plot/common/event-stream";
import {
	decodePlotServerRecord,
	makePlotEventRecord,
	plotProtocolVersion,
	plotStateSchema,
	safeParseEventLogEvent,
	type EventLogEvent,
	type PlotClientRecord,
	type PlotServerRecord,
	type PlotSessionMetadata,
	type PlotState,
} from "@plot/session/protocol";
import {
	initialJsonlDecoderState,
	splitJsonlChunk,
	type JsonlDecoderState,
} from "./protocol-jsonl.js";
import { resolvePlotPaths } from "./plot-paths.js";

export type PlotInstanceStatus =
	| "starting"
	| "online"
	| "stopping"
	| "stopped"
	| "error";

export interface PlotInstanceRecord {
	readonly id: string;
	readonly status: PlotInstanceStatus;
	readonly cwd: string;
	readonly createdAt: string;
	readonly lastSeenAt?: string;
	readonly label?: string;
	readonly sessionId?: string;
	readonly workflowName?: string;
	readonly workflowPath?: string;
	readonly cwdName?: string;
	readonly sessionDir?: string;
	readonly eventLogPath?: string;
	readonly lastSequence?: number;
	readonly lastEventType?: string;
}

export interface PlotSupervisorOptions {
	readonly cwd: string;
	readonly plotDir?: string;
	readonly agentDir?: string;
	readonly cli?: { readonly command: string; readonly args: readonly string[] };
	readonly eventCapacity?: number;
}

export interface PlotSupervisorSpawnOptions {
	readonly cwd?: string;
	readonly label?: string;
	readonly sessionId?: string;
	readonly workflowPath?: string;
	readonly plotDir?: string;
	readonly agentDir?: string;
	readonly sessionDir?: string;
	readonly logLevel?: string;
}

interface LiveInstanceResources {
	child?: ChildProcess;
	sessionId?: string;
}

interface LiveInstance {
	record: PlotInstanceRecord;
	resources: LiveInstanceResources;
	decoder: TextDecoder;
	jsonl: JsonlDecoderState;
	stderr: string;
	events: EventHub<PlotServerRecord>;
	pending: Map<
		string,
		{
			readonly resolve: (record: PlotServerRecord) => void;
			readonly reject: (error: Error) => void;
		}
	>;
}

const clone = (record: PlotInstanceRecord): PlotInstanceRecord => ({
	...record,
});

const metadataUpdates = (
	value: PlotSessionMetadata | undefined,
): Partial<PlotInstanceRecord> =>
	value === undefined
		? {}
		: {
				workflowName: value.workflowName,
				workflowPath: value.workflowPath,
				cwd: value.cwd,
				cwdName: value.cwdName,
				sessionDir: value.sessionDir,
				eventLogPath: value.eventLogPath,
			};

const parseGetStateResponse = (
	record: PlotServerRecord,
): PlotState | undefined => {
	if (
		record.kind !== "response" ||
		!record.ok ||
		record.command !== "get_state"
	)
		return undefined;
	const parsed = plotStateSchema.safeParse(record.data);
	return parsed.success ? parsed.data : undefined;
};

interface EventLogTailState {
	readonly decoder: TextDecoder;
	readonly jsonl: JsonlDecoderState;
	readonly offset: number;
}

const initialEventLogTailState = (offset = 0): EventLogTailState => ({
	decoder: new TextDecoder(),
	jsonl: initialJsonlDecoderState,
	offset,
});

const parseEventLogLine = (line: string): EventLogEvent | undefined => {
	try {
		const parsed = safeParseEventLogEvent(JSON.parse(line) as unknown);
		return parsed.success ? parsed.data : undefined;
	} catch {
		return undefined;
	}
};

const readEventLogTail = async (input: {
	readonly after: number;
	readonly path: string;
	readonly state: EventLogTailState;
}): Promise<{
	readonly events: readonly EventLogEvent[];
	readonly state: EventLogTailState;
}> => {
	let file;
	try {
		file = await open(input.path, "r");
	} catch {
		return { events: [], state: input.state };
	}
	try {
		const stats = await file.stat();
		let state =
			stats.size < input.state.offset
				? initialEventLogTailState()
				: input.state;
		const events: EventLogEvent[] = [];
		const buffer = Buffer.alloc(64 * 1024);
		while (state.offset < stats.size) {
			const { bytesRead } = await file.read(
				buffer,
				0,
				Math.min(buffer.length, stats.size - state.offset),
				state.offset,
			);
			if (bytesRead <= 0) break;
			const nextOffset = state.offset + bytesRead;
			const chunk = state.decoder.decode(buffer.subarray(0, bytesRead), {
				stream: true,
			});
			const split = await splitJsonlChunk(state.jsonl, chunk);
			state = { ...state, jsonl: split.state, offset: nextOffset };
			for (const line of split.lines) {
				const event = parseEventLogLine(line);
				if (event === undefined || Number(event.sequence) <= input.after)
					continue;
				events.push(event);
			}
		}
		return { events, state };
	} finally {
		await file.close();
	}
};

const isBunBinary =
	import.meta.url.includes("$bunfs") ||
	import.meta.url.includes("~BUN") ||
	import.meta.url.includes("%7EBUN");

export const resolvePlotCliSpawnCommand = (): {
	readonly command: string;
	readonly args: readonly string[];
} => {
	if (process.env["PLOT_LOCAL_SERVER_BINARY"])
		return { command: process.env["PLOT_LOCAL_SERVER_BINARY"], args: [] };
	if (isBunBinary) return { command: process.execPath, args: [] };
	if (process.argv[1] !== undefined)
		return { command: process.execPath, args: [process.argv[1]] };
	return {
		command: join(
			dirname(process.execPath),
			process.platform === "win32" ? "plot.exe" : "plot",
		),
		args: [],
	};
};

const defaultCli = resolvePlotCliSpawnCommand;

const instanceArgs = (
	options: PlotSupervisorSpawnOptions,
): readonly string[] => {
	const args = ["serve", "stdio", "--cwd", options.cwd ?? process.cwd()];
	const push = (flag: string, value: string | undefined) => {
		if (value !== undefined) args.push(flag, value);
	};
	push("--session-id", options.sessionId);
	push("--workflow", options.workflowPath);
	push("--plot-dir", options.plotDir);
	push("--agent-dir", options.agentDir);
	push("--session-dir", options.sessionDir);
	push("--log-level", options.logLevel ?? "warn");
	return args;
};

const supervisorDir = (options: PlotSupervisorOptions): string =>
	join(
		resolvePlotPaths({
			cwd: options.cwd,
			...(options.plotDir === undefined ? {} : { plotDir: options.plotDir }),
			...(options.agentDir === undefined ? {} : { agentDir: options.agentDir }),
		}).plotDir,
		"supervisor",
	);

export const resolvePlotSupervisorSocketPath = (
	options: PlotSupervisorOptions,
): string => join(supervisorDir(options), "supervisor.sock");

const instancesPath = (options: PlotSupervisorOptions): string =>
	join(supervisorDir(options), "instances.json");

const ensureDir = (options: PlotSupervisorOptions): void => {
	mkdirSync(supervisorDir(options), { recursive: true, mode: 0o700 });
};

const readInstances = (
	options: PlotSupervisorOptions,
): PlotInstanceRecord[] => {
	const path = instancesPath(options);
	if (!existsSync(path)) return [];
	return JSON.parse(readFileSync(path, "utf8")) as PlotInstanceRecord[];
};

const writeInstances = (
	options: PlotSupervisorOptions,
	instances: readonly PlotInstanceRecord[],
): void => {
	ensureDir(options);
	writeFileSync(
		instancesPath(options),
		`${JSON.stringify(instances, null, 2)}\n`,
	);
};

const upsertInstance = (
	options: PlotSupervisorOptions,
	record: PlotInstanceRecord,
): void => {
	const instances = readInstances(options);
	const index = instances.findIndex((instance) => instance.id === record.id);
	if (index === -1) instances.push(record);
	else instances[index] = record;
	writeInstances(options, instances);
};

const removeInstance = (options: PlotSupervisorOptions, id: string): void =>
	writeInstances(
		options,
		readInstances(options).filter((instance) => instance.id !== id),
	);

export class PlotSupervisor {
	private readonly live = new Map<string, LiveInstance>();
	private readonly options: PlotSupervisorOptions;

	constructor(options: PlotSupervisorOptions) {
		this.options = options;
	}

	private setStatus(live: LiveInstance, status: PlotInstanceStatus): void {
		live.record = {
			...live.record,
			status,
			lastSeenAt: new Date().toISOString(),
		};
		upsertInstance(this.options, live.record);
	}

	private updateRecord(
		live: LiveInstance,
		updates: Partial<PlotInstanceRecord>,
	): void {
		live.record = {
			...live.record,
			...updates,
			lastSeenAt: new Date().toISOString(),
		};
		if (updates.sessionId !== undefined)
			live.resources.sessionId = updates.sessionId;
		upsertInstance(this.options, live.record);
	}

	private async handleStdout(live: LiveInstance, chunk: Buffer | string) {
		const text =
			typeof chunk === "string"
				? chunk
				: live.decoder.decode(chunk, { stream: true });
		const split = await splitJsonlChunk(live.jsonl, text);
		live.jsonl = split.state;
		for (const line of split.lines) {
			if (line === "") continue;
			const record = decodePlotServerRecord(JSON.parse(line) as unknown);
			if (record.kind === "welcome")
				this.updateRecord(live, { sessionId: record.sessionId });
			if (record.kind === "response" && record.id !== undefined) {
				live.pending.get(record.id)?.resolve(record);
				live.pending.delete(record.id);
			}
			if (record.kind === "event")
				this.updateRecord(live, {
					lastSequence: record.event.sequence,
					lastEventType: record.event.type,
				});
			live.events.publish(record);
		}
	}

	private handleUnexpectedExit(live: LiveInstance): void {
		if (this.live.get(live.record.id) !== live) return;
		if (live.record.status === "stopping" || live.record.status === "stopped")
			return;
		this.setStatus(live, "error");
		for (const pending of live.pending.values())
			pending.reject(new Error(`instance exited: ${live.stderr}`));
		live.pending.clear();
		live.events.close();
		this.live.delete(live.record.id);
	}

	private async syncInstanceRecord(live: LiveInstance): Promise<void> {
		const response = await this.send(live, {
			protocol: plotProtocolVersion,
			kind: "request",
			id: `supervisor_get_state_${randomUUID()}`,
			command: "get_state",
			params: {},
		});
		const state = parseGetStateResponse(response);
		if (state === undefined) {
			this.updateRecord(live, {});
			return;
		}
		this.updateRecord(live, {
			sessionId: state.sessionId,
			...metadataUpdates(state.metadata),
		});
	}

	private send(
		live: LiveInstance,
		request: PlotClientRecord,
	): Promise<PlotServerRecord> {
		const child = live.resources.child;
		if (child?.stdin === undefined) throw new Error("instance is not online");
		return new Promise((resolve, reject) => {
			live.pending.set(request.id, { resolve, reject });
			child.stdin?.write(`${JSON.stringify(request)}\n`, (error) => {
				if (error === undefined) return;
				live.pending.delete(request.id);
				reject(error);
			});
		});
	}

	async recoverAfterRestart(): Promise<void> {
		const recoveredAt = new Date().toISOString();
		writeInstances(
			this.options,
			readInstances(this.options).map((instance) => ({
				...instance,
				status:
					instance.status === "online" || instance.status === "starting"
						? "stopped"
						: instance.status,
				lastSeenAt: recoveredAt,
			})),
		);
	}

	listInstances(): readonly PlotInstanceRecord[] {
		const records = new Map(
			readInstances(this.options).map((instance) => [
				instance.id,
				clone(instance),
			]),
		);
		for (const live of this.live.values())
			records.set(live.record.id, clone(live.record));
		return [...records.values()];
	}

	getInstance(id: string): PlotInstanceRecord | undefined {
		const live = this.live.get(id);
		if (live) return clone(live.record);
		return readInstances(this.options).find((instance) => instance.id === id);
	}

	async spawnInstance(
		options: PlotSupervisorSpawnOptions = {},
	): Promise<PlotInstanceRecord> {
		const now = new Date().toISOString();
		const cli = this.options.cli ?? defaultCli();
		const live: LiveInstance = {
			record: {
				id: randomUUID(),
				status: "starting",
				cwd: options.cwd ?? this.options.cwd,
				createdAt: now,
				lastSeenAt: now,
				...(options.label === undefined ? {} : { label: options.label }),
				...(options.sessionId === undefined
					? {}
					: { sessionId: options.sessionId }),
				...(options.workflowPath === undefined
					? {}
					: { workflowPath: options.workflowPath }),
			},
			resources: {},
			decoder: new TextDecoder(),
			jsonl: initialJsonlDecoderState,
			stderr: "",
			events: new EventHub<PlotServerRecord>(
				this.options.eventCapacity ?? 1024,
			),
			pending: new Map(),
		};
		this.live.set(live.record.id, live);
		upsertInstance(this.options, live.record);
		try {
			const child = spawn(
				cli.command,
				[...cli.args, ...instanceArgs({ ...options, cwd: live.record.cwd })],
				{
					cwd: live.record.cwd,
					env: process.env,
					stdio: ["pipe", "pipe", "pipe"],
				},
			);
			live.resources.child = child;
			child.stdout?.on("data", (chunk) => {
				void this.handleStdout(live, chunk).catch(() =>
					this.handleUnexpectedExit(live),
				);
			});
			child.stderr?.on("data", (chunk: Buffer | string) => {
				live.stderr += chunk.toString();
			});
			child.once("error", () => this.handleUnexpectedExit(live));
			child.once("exit", () => this.handleUnexpectedExit(live));
			await new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(
					() => reject(new Error("instance did not send welcome")),
					10_000,
				);
				const unsub = live.events.subscribe();
				void (async () => {
					for await (const record of unsub) {
						if (record.kind !== "welcome") continue;
						clearTimeout(timeout);
						resolve();
						break;
					}
				})().catch(reject);
			});
			await this.syncInstanceRecord(live);
			await this.send(live, {
				protocol: plotProtocolVersion,
				kind: "request",
				id: `supervisor_start_${randomUUID()}`,
				command: "start",
				params: {},
			});
			this.setStatus(live, "online");
			return clone(live.record);
		} catch (error) {
			this.setStatus(live, "error");
			await this.stopInstance(live.record.id).catch(() => undefined);
			throw error;
		}
	}

	async stopInstance(id: string): Promise<PlotInstanceRecord | undefined> {
		const live = this.live.get(id);
		if (!live) return undefined;
		this.setStatus(live, "stopping");
		try {
			await this.send(live, {
				protocol: plotProtocolVersion,
				kind: "request",
				id: `supervisor_shutdown_${randomUUID()}`,
				command: "shutdown",
				params: {},
			}).catch(() => undefined);
			live.resources.child?.kill("SIGTERM");
		} finally {
			live.events.close();
			this.live.delete(id);
			live.record = {
				...live.record,
				status: "stopped",
				lastSeenAt: new Date().toISOString(),
			};
			removeInstance(this.options, id);
		}
		return clone(live.record);
	}

	openProtocolStream(
		id: string,
		afterSequence = 0,
	):
		| {
				readonly records: () => AsyncIterable<PlotServerRecord>;
				readonly submit: (
					request: PlotClientRecord,
				) => Promise<PlotServerRecord>;
				readonly close: () => void;
		  }
		| undefined {
		const live = this.live.get(id);
		if (!live) return undefined;
		return {
			records: () => this.attachRecords(id, afterSequence),
			submit: (request) => this.send(live, request),
			close: () => undefined,
		};
	}

	async *attachRecords(
		id: string,
		afterSequence: number,
	): AsyncIterable<PlotServerRecord> {
		const live = this.live.get(id);
		const instance = live?.record ?? this.getInstance(id);
		if (instance === undefined) return;
		const subscribed = live?.events.subscribe();
		let frontier = afterSequence;
		if (instance.eventLogPath !== undefined) {
			const tail = await readEventLogTail({
				after: frontier,
				path: instance.eventLogPath,
				state: initialEventLogTailState(),
			});
			for (const event of tail.events) {
				frontier = Number(event.sequence);
				yield makePlotEventRecord(event);
			}
		}
		if (subscribed === undefined) return;
		for await (const record of subscribed) {
			if (record.kind !== "event") continue;
			const sequence = record.event.sequence;
			if (sequence === undefined || sequence <= frontier) continue;
			frontier = sequence;
			yield record;
		}
	}

	async shutdown(): Promise<void> {
		for (const id of Array.from(this.live.keys())) await this.stopInstance(id);
	}
}
