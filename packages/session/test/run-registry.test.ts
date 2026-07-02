import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "bun:test";
import { AsyncQueue } from "@plot/common/async-queue";
import {
	RunRegistry,
	createFileRunStore,
	createMemoryRunStore,
	decodeRunRequest,
} from "../src/run-registry.js";
import type { RunChildProcess } from "../src/run-process.js";
import {
	openRunIpc,
	resolveRunIpcSocketPath,
	startRunIpcDaemon,
	sendRunIpcRequest,
	startRunIpcServer,
} from "../src/run-ipc.js";
import {
	decodeClientRequestLine,
	encodeServerRecordLine,
} from "../src/protocol-codec.js";
import type { ServerRecord } from "../src/protocol.js";

class FakeChild implements RunChildProcess {
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

	constructor(
		readonly sessionId = "session-runRegistry",
		readonly state: Record<string, unknown> = {},
	) {}

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
				request.command === "get_state"
					? { sessionId: this.sessionId, ...this.state }
					: {},
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

test("runRegistry rejects invalid IPC shapes at the boundary", () => {
	expect(() => decodeRunRequest({ type: "status" })).toThrow();
	expect(() => decodeRunRequest({ type: "status", id: "run-1" })).not.toThrow();
});

test("runRegistry requires an explicit CLI command for real child processes", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "plot-run-command-"));
	const runRegistry = new RunRegistry({ cwd, store: createMemoryRunStore() });
	await expect(runRegistry.spawn()).rejects.toThrow("CLI command");
});

test("runRegistry spawns, bounds stderr, and stops child lifecycle", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "plot-runRegistry-"));
	const store = createMemoryRunStore();
	let child: FakeChild | undefined;
	let childInput:
		| {
				readonly command: string;
				readonly args: readonly string[];
				readonly cwd: string;
		  }
		| undefined;
	const runRegistry = new RunRegistry({
		cli: { command: "bun", args: ["./packages/cli/src/main.ts"] },
		cwd,
		store,
		id: () => "run-1",
		now: () => "2026-01-01T00:00:00.000Z",
		stderrLimitBytes: 8,
		spawnChild: (input) => {
			childInput = input;
			child = new FakeChild("session-runRegistry", {
				sessionDir: join(cwd, ".plot", "sessions"),
				workflowName: "workflow",
			});
			queueMicrotask(() =>
				child?.emit({
					protocol: "plot.session.v2",
					kind: "welcome",
					sessionId: "session-runRegistry",
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

	const spawned = await runRegistry.spawn({ label: "test" });
	child?.emitStderr("abcdefghijklmnopqrstuvwxyz");
	await new Promise((resolve) => setTimeout(resolve, 0));
	const stopped = await runRegistry.stop(spawned.id);

	expect(spawned).toMatchObject({
		id: "run-1",
		status: "online",
		sessionId: "session-runRegistry",
		sessionDir: join(cwd, ".plot", "sessions"),
		workflowName: "workflow",
	});
	expect(childInput).toMatchObject({
		command: "bun",
		args: ["./packages/cli/src/main.ts", "__internal-api-stdio", "--cwd", cwd],
	});
	expect(
		child?.writes.map((line) => decodeClientRequestLine(line).command),
	).toEqual(["start", "get_state", "shutdown"]);
	expect(child?.killed).toBe(true);
	expect(stopped).toMatchObject({ status: "stopped", stderrTail: "stuvwxyz" });
});

test("runRegistry marks a child that exits before welcome as error", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "plot-runRegistry-exit-"));
	const store = createMemoryRunStore();
	let child: FakeChild | undefined;
	const runRegistry = new RunRegistry({
		cwd,
		store,
		id: () => "run-exit",
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

	await expect(runRegistry.spawn()).rejects.toThrow("run process exited");
	expect(await store.get("run-exit")).toMatchObject({
		status: "error",
		stderrTail: expect.stringContaining("boot failed"),
	});
});

test("file run store ignores a corrupt final record", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "plot-run-store-corrupt-"));
	const path = join(cwd, "runs.json");
	await writeFile(
		path,
		`[\n  {\n    "id": "complete",\n    "status": "stopped",\n    "cwd": "${cwd}",\n    "createdAt": "2026-01-01T00:00:00.000Z"\n  },\n  {\n    "id": "partial"\n`,
	);

	expect(await createFileRunStore(path).list()).toEqual([
		expect.objectContaining({ id: "complete" }),
	]);
});

test("file run store drops removed run fields", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "plot-run-store-legacy-"));
	const path = join(cwd, "runs.json");
	await writeFile(
		path,
		JSON.stringify([
			{
				id: "legacy",
				status: "stopped",
				cwd,
				createdAt: "2026-01-01T00:00:00.000Z",
				eventLogPath: join(cwd, "old.jsonl"),
			},
		]),
	);

	expect(await createFileRunStore(path).list()).toEqual([
		expect.not.objectContaining({ eventLogPath: expect.anything() }),
	]);
});

test("runRegistry recovery does not leave stale runs online", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "plot-runRegistry-recover-"));
	const store = createFileRunStore(
		join(cwd, ".plot", "runRegistry", "runs.json"),
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

	const runRegistry = new RunRegistry({ cwd, store });
	await runRegistry.recoverAfterRestart();

	expect(await runRegistry.status("stale-online")).toMatchObject({
		status: "stopped",
	});
	expect(await runRegistry.status("stale-starting")).toMatchObject({
		status: "stopped",
	});
});

test("runRegistry attach is live-only", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "plot-runRegistry-live-only-"));
	const runRegistry = new RunRegistry({
		cwd,
		store: createMemoryRunStore([
			{
				id: "run-stopped",
				status: "stopped",
				cwd,
				createdAt: "2026-01-01T00:00:00.000Z",
				sessionId: "session-stopped",
			},
		]),
	});
	const records = [];
	for await (const record of runRegistry.attachRecords("run-stopped", 0))
		records.push(record);

	expect(records).toEqual([]);
});

test("runRegistry IPC does not start an in-process registry", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "p-"));
	const options = { cwd, runRegistryDir: join(cwd, ".plot", "runRegistry") };
	await expect(openRunIpc(options)).rejects.toThrow();
	expect(existsSync(resolveRunIpcSocketPath(options))).toBe(false);
});

test("runRegistry IPC rejects when the socket closes before a response", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "p-"));
	const options = { cwd, runRegistryDir: join(cwd, ".plot", "runRegistry") };
	const socketPath = resolveRunIpcSocketPath(options);
	await mkdir(dirname(socketPath), { recursive: true });
	const server = createServer((socket) => socket.end());
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(socketPath, () => {
			server.off("error", reject);
			resolve();
		});
	});
	try {
		await expect(sendRunIpcRequest(options, { type: "list" })).rejects.toThrow(
			/run registry closed before response/,
		);
	} finally {
		server.close();
	}
});

test("runRegistry IPC rejects malformed responses", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "p-"));
	const options = { cwd, runRegistryDir: join(cwd, ".plot", "runRegistry") };
	const socketPath = resolveRunIpcSocketPath(options);
	await mkdir(dirname(socketPath), { recursive: true });
	const server = createServer((socket) => socket.end("not-json\n"));
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(socketPath, () => {
			server.off("error", reject);
			resolve();
		});
	});
	try {
		await expect(
			sendRunIpcRequest(options, { type: "list" }),
		).rejects.toThrow();
	} finally {
		server.close();
	}
});

test("runRegistry IPC daemon start rejects spawn errors", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "p-"));
	await expect(
		startRunIpcDaemon({
			cwd,
			runRegistryDir: join(cwd, ".plot", "runRegistry"),
			cli: { command: join(cwd, "missing-plot"), args: [] },
		}),
	).rejects.toThrow();
});

test("runRegistry IPC opens the existing shared run registry", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "p-"));
	const child = new FakeChild("session-shared");
	const runRegistry = new RunRegistry({
		cwd,
		store: createMemoryRunStore(),
		id: () => "run-shared",
		spawnChild: () => {
			queueMicrotask(() =>
				child.emit({
					protocol: "plot.session.v2",
					kind: "welcome",
					sessionId: "session-shared",
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
	await runRegistry.spawn();
	const server = await startRunIpcServer({
		options: { cwd, runRegistryDir: join(cwd, ".plot", "runRegistry") },
		runRegistry,
	});
	try {
		const opened = await openRunIpc({
			cwd,
			runRegistryDir: join(cwd, ".plot", "runRegistry"),
		});
		expect(opened.owned).toBe(false);
		expect(await opened.runRegistry.status("run-shared")).toMatchObject({
			id: "run-shared",
			status: "online",
		});
		expect(
			await opened.runRegistry.submit("run-shared", {
				protocol: "plot.session.v2",
				kind: "request",
				id: "client-1",
				command: "ping",
			}),
		).toMatchObject({ id: "client-1", command: "ping", ok: true });
		await opened.close();
		expect(await runRegistry.status("run-shared")).toMatchObject({
			status: "online",
		});
	} finally {
		server.server.close();
		await runRegistry.shutdown();
	}
});

test("runRegistry IPC refuses to replace a live socket", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "p-"));
	const options = { cwd, runRegistryDir: join(cwd, ".plot", "runRegistry") };
	const first = await startRunIpcServer({ options });
	try {
		await expect(startRunIpcServer({ options })).rejects.toThrow(
			/run registry is already running/,
		);
		expect(await sendRunIpcRequest(options, { type: "list" })).toMatchObject({
			type: "list_result",
			ok: true,
		});
	} finally {
		first.server.close();
		await first.runRegistry.shutdown();
	}
});

test("runRegistry IPC survives a client disconnecting from a protocol stream", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "p-"));
	const runRegistry = new RunRegistry({
		cwd,
		store: createMemoryRunStore(),
		id: () => "run-stream",
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
	await runRegistry.spawn();
	const server = await startRunIpcServer({
		options: { cwd, runRegistryDir: join(cwd, ".plot", "runRegistry") },
		runRegistry,
	});
	try {
		const socket = createConnection(server.socketPath);
		await new Promise<void>((resolve, reject) => {
			socket.once("connect", resolve);
			socket.once("error", reject);
		});
		socket.write(
			`${JSON.stringify({ type: "protocol_stream", id: "run-stream" })}\n`,
		);
		await new Promise<void>((resolve) => socket.once("data", () => resolve()));
		socket.destroy();

		expect(
			await sendRunIpcRequest(
				{ cwd, runRegistryDir: join(cwd, ".plot", "runRegistry") },
				{ type: "list" },
			),
		).toMatchObject({ type: "list_result", ok: true });
	} finally {
		server.server.close();
		await runRegistry.shutdown();
	}
});
