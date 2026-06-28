import { mkdtemp } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { AsyncQueue } from "@plot/common/async-queue";
import { createFileEventLogStore } from "../src/event-log.js";
import {
	Fleet,
	createFileFleetStore,
	createMemoryFleetStore,
	decodeFleetRequest,
	type FleetChildProcess,
} from "../src/fleet.js";
import { sendFleetIpcRequest, startFleetIpcServer } from "../src/fleet-ipc.js";
import {
	decodeClientRequestLine,
	encodeServerRecordLine,
} from "../src/protocol-codec.js";
import type { ServerRecord } from "../src/protocol.js";

class FakeChild implements FleetChildProcess {
	readonly pid = 123;
	readonly stdoutQueue = new AsyncQueue<string | Uint8Array>({ capacity: 32 });
	readonly stderrQueue = new AsyncQueue<string | Uint8Array>({ capacity: 32 });
	readonly stdout = this.stdoutQueue as AsyncIterable<string | Uint8Array>;
	readonly stderr = this.stderrQueue as AsyncIterable<string | Uint8Array>;
	readonly writes: string[] = [];
	private resolveExited!: () => void;
	killed = false;
	readonly exited = new Promise<void>((resolve) => {
		this.resolveExited = resolve;
	});

	constructor(readonly sessionId = "session-fleet") {}

	write(line: string): void {
		this.writes.push(line);
		const request = decodeClientRequestLine(line);
		this.emit({
			protocol: "plot.session.v2",
			kind: "response",
			id: request.id,
			command: request.command,
			ok: true,
			data:
				request.command === "get_state" ? { sessionId: this.sessionId } : {},
		});
	}

	kill(): void {
		this.killed = true;
		this.exit();
	}

	exit(): void {
		this.stdoutQueue.close();
		this.stderrQueue.close();
		this.resolveExited();
	}

	emit(record: ServerRecord): void {
		this.stdoutQueue.offer(encodeServerRecordLine(record), { force: true });
	}

	emitStderr(text: string): void {
		this.stderrQueue.offer(text, { force: true });
	}
}

test("fleet rejects invalid IPC shapes at the boundary", () => {
	expect(() => decodeFleetRequest({ type: "status" })).toThrow();
	expect(() =>
		decodeFleetRequest({ type: "status", id: "instance-1" }),
	).not.toThrow();
});

test("fleet spawns, bounds stderr, and stops child lifecycle", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "plot-fleet-"));
	const store = createMemoryFleetStore();
	let child: FakeChild | undefined;
	const fleet = new Fleet({
		cwd,
		store,
		id: () => "instance-1",
		now: () => "2026-01-01T00:00:00.000Z",
		stderrLimitBytes: 8,
		spawnChild: () => {
			child = new FakeChild();
			queueMicrotask(() =>
				child?.emit({
					protocol: "plot.session.v2",
					kind: "welcome",
					sessionId: "session-fleet",
					limits: {
						maxInputLineBytes: 1_000,
						maxOutputLineBytes: 1_000,
						maxPendingRequests: 4,
						maxBufferedEvents: 4,
					},
				}),
			);
			return child;
		},
	});

	const spawned = await fleet.spawn({ label: "test" });
	child?.emitStderr("abcdefghijklmnopqrstuvwxyz");
	await new Promise((resolve) => setTimeout(resolve, 0));
	const stopped = await fleet.stop(spawned.id);

	expect(spawned).toMatchObject({
		id: "instance-1",
		status: "online",
		sessionId: "session-fleet",
	});
	expect(
		child?.writes.map((line) => decodeClientRequestLine(line).command),
	).toEqual(["start", "shutdown"]);
	expect(child?.killed).toBe(true);
	expect(stopped).toMatchObject({ status: "stopped", stderrTail: "stuvwxyz" });
});

test("fleet marks a child that exits before welcome as error", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "plot-fleet-exit-"));
	const store = createMemoryFleetStore();
	let child: FakeChild | undefined;
	const fleet = new Fleet({
		cwd,
		store,
		id: () => "instance-exit",
		spawnDeadlineMs: 50,
		spawnChild: () => {
			child = new FakeChild();
			queueMicrotask(() => {
				child?.emitStderr("boot failed");
				child?.exit();
			});
			return child;
		},
	});

	await expect(fleet.spawn()).rejects.toThrow("closed before welcome");
	expect(await store.get("instance-exit")).toMatchObject({
		status: "error",
		stderrTail: expect.stringContaining("boot failed"),
	});
});

test("fleet recovery does not leave stale instances online", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "plot-fleet-recover-"));
	const store = createFileFleetStore(
		join(cwd, ".plot", "fleet", "instances.json"),
	);
	await store.upsert({
		id: "stale-online",
		status: "online",
		cwd,
		createdAt: "2026-01-01T00:00:00.000Z",
	});
	await store.upsert({
		id: "stale-starting",
		status: "starting",
		cwd,
		createdAt: "2026-01-01T00:00:00.000Z",
	});

	const fleet = new Fleet({ cwd, store });
	await fleet.recoverAfterRestart();

	expect(await fleet.status("stale-online")).toMatchObject({
		status: "stopped",
	});
	expect(await fleet.status("stale-starting")).toMatchObject({
		status: "stopped",
	});
});

test("fleet attach replays only durable event log records after a sequence", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "plot-fleet-replay-"));
	const eventLog = await createFileEventLogStore({
		sessionId: "session-replay",
		sessionDir: join(cwd, ".plot", "sessions"),
	});
	for (let tickId = 1; tickId <= 30; tickId++) {
		// eslint-disable-next-line no-await-in-loop -- replay fixture needs deterministic sequence order.
		await eventLog.appendSessionEvent({
			type: "tick_started",
			payload: { tickId },
		});
	}
	const fleet = new Fleet({
		cwd,
		store: createMemoryFleetStore([
			{
				id: "instance-replay",
				status: "stopped",
				cwd,
				createdAt: "2026-01-01T00:00:00.000Z",
				sessionId: "session-replay",
				eventLogPath: eventLog.path,
			},
		]),
	});
	const records = [];
	for await (const record of fleet.attachRecords("instance-replay", 20))
		records.push(record);

	expect(
		records.flatMap((record) =>
			record.kind === "event" ? [record.sequence] : [],
		),
	).toEqual([21, 22, 23, 24, 25, 26, 27, 28, 29, 30]);
});

test("fleet IPC survives a client disconnecting from a protocol stream", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "plot-fleet-ipc-"));
	const fleet = new Fleet({
		cwd,
		store: createMemoryFleetStore(),
		id: () => "instance-stream",
		spawnChild: () => {
			const child = new FakeChild("session-stream");
			queueMicrotask(() =>
				child.emit({
					protocol: "plot.session.v2",
					kind: "welcome",
					sessionId: "session-stream",
					limits: {
						maxInputLineBytes: 1_000,
						maxOutputLineBytes: 1_000,
						maxPendingRequests: 4,
						maxBufferedEvents: 4,
					},
				}),
			);
			return child;
		},
	});
	await fleet.spawn();
	const server = await startFleetIpcServer({
		options: { cwd, fleetDir: join(cwd, ".plot", "fleet") },
		fleet,
	});
	try {
		const socket = createConnection(server.socketPath);
		await new Promise<void>((resolve, reject) => {
			socket.once("connect", resolve);
			socket.once("error", reject);
		});
		socket.write(
			`${JSON.stringify({ type: "protocol_stream", id: "instance-stream" })}\n`,
		);
		await new Promise<void>((resolve) => socket.once("data", () => resolve()));
		socket.destroy();

		expect(
			await sendFleetIpcRequest(
				{ cwd, fleetDir: join(cwd, ".plot", "fleet") },
				{ type: "list" },
			),
		).toMatchObject({ type: "list_result", ok: true });
	} finally {
		server.server.close();
		await fleet.shutdown();
	}
});
