import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { AsyncQueue } from "@plot/common/async-queue";
import type {
	SessionWorkerCommand,
	SessionWorkerRecord,
} from "@plot/session/worker";
import { encodeSessionWorkerRecord } from "@plot/session/worker";
import {
	createSessionManagerClient,
	startSessionManagerServer,
} from "../src/ipc.js";
import { SessionManager } from "../src/manager.js";
import type { SessionChildProcess } from "../src/session-process.js";
import { createMemorySessionStore } from "../src/session-store.js";

const fakeWorker = (input: {
	readonly sessionId: string;
	readonly workflowPath: string;
}): SessionChildProcess => {
	const stdout = new AsyncQueue<string>();
	const stderr = new AsyncQueue<string>();
	let resolveExited!: () => void;
	const exited = new Promise<void>((resolve) => {
		resolveExited = resolve;
	});
	const respond = (record: SessionWorkerRecord) =>
		stdout.offer(encodeSessionWorkerRecord(record), { force: true });
	respond({
		kind: "ready",
		sessionId: input.sessionId,
		workflowName: input.workflowPath.split("/").at(-1) ?? "workflow",
		workflowPath: input.workflowPath,
		projectPath: input.workflowPath.slice(
			0,
			input.workflowPath.lastIndexOf("/"),
		),
		historyPath: `${input.workflowPath}.jsonl`,
	});
	return {
		pid: 42,
		stdout,
		stderr,
		write: (line) => {
			const command = JSON.parse(line) as SessionWorkerCommand;
			respond({ kind: "result", id: command.id, ok: true, value: true });
		},
		kill: () => {
			stdout.close();
			stderr.close();
			resolveExited();
		},
		exited,
	};
};

const manager = (input?: {
	readonly canonicalize?: (path: string) => Promise<string>;
	onSpawn?: (path: string, worker: SessionChildProcess) => void;
}) =>
	new SessionManager({
		store: createMemorySessionStore(),
		cli: { command: "plot", args: [] },
		canonicalize: input?.canonicalize ?? (async (path) => path),
		id: (() => {
			let id = 0;
			return () => `session-${++id}`;
		})(),
		spawnChild: ({ args }) => {
			const sessionId = args[args.indexOf("--session-id") + 1]!;
			const workflowPath = args[args.indexOf("--workflow") + 1]!;
			const worker = fakeWorker({ sessionId, workflowPath });
			input?.onSpawn?.(workflowPath, worker);
			return worker;
		},
	});

test("equivalent Workflow paths start exactly one active Session", async () => {
	let spawns = 0;
	const canonical = "/repo/WORKFLOW.md";
	const sessions = manager({
		canonicalize: async () => canonical,
		onSpawn: () => spawns++,
	});

	const [first, second] = await Promise.all([
		sessions.start({ cwd: "/repo", workflowPath: "WORKFLOW.md" }),
		sessions.start({ cwd: "/repo", workflowPath: "./WORKFLOW.md" }),
	]);

	expect(spawns).toBe(1);
	expect(first.session.id).toBe(second.session.id);
	expect([first.started, second.started].filter(Boolean)).toHaveLength(1);
	await sessions.shutdown();
});

test("different Workflows may run concurrently", async () => {
	const sessions = manager();

	const [acme, plot] = await Promise.all([
		sessions.start({ cwd: "/repo", workflowPath: "/repo/acme.md" }),
		sessions.start({ cwd: "/repo", workflowPath: "/repo/plot.md" }),
	]);

	expect(acme.session.id).not.toBe(plot.session.id);
	expect(
		(await sessions.list()).filter((session) => session.state === "online"),
	).toHaveLength(2);
	await sessions.shutdown();
});

test("stop is idempotent and releases the Workflow", async () => {
	const sessions = manager();
	const first = await sessions.start({
		cwd: "/repo",
		workflowPath: "/repo/WORKFLOW.md",
	});

	const [stopped, sameStop] = await Promise.all([
		sessions.stop("/repo/WORKFLOW.md"),
		sessions.stop("/repo/WORKFLOW.md"),
	]);
	expect(stopped?.state).toBe("stopped");
	expect(sameStop?.id).toBe(stopped?.id);
	expect(await sessions.stop("/repo/WORKFLOW.md")).toBeUndefined();
	const restarted = await sessions.start({
		cwd: "/repo",
		workflowPath: "/repo/WORKFLOW.md",
	});
	expect(restarted.session.id).not.toBe(first.session.id);
	await sessions.shutdown();
});

const waitFor = async (predicate: () => Promise<boolean>): Promise<void> => {
	for (let attempt = 0; attempt < 50; attempt++) {
		// eslint-disable-next-line no-await-in-loop -- bounded asynchronous state polling.
		if (await predicate()) return;
		// eslint-disable-next-line no-await-in-loop -- bounded asynchronous state polling.
		await Bun.sleep(1);
	}
	throw new Error("condition was not met");
};

test("an aborted IPC continuation releases an idle event stream", async () => {
	const managerDir = await mkdtemp(join(tmpdir(), "plot-manager-ipc-"));
	const sessions = manager();
	const active = await sessions.start({
		cwd: "/repo",
		workflowPath: "/repo/WORKFLOW.md",
	});
	const server = await startSessionManagerServer({
		options: { managerDir },
		manager: sessions,
	});
	const client = createSessionManagerClient({ managerDir });
	const controller = new AbortController();
	const events = client.events(active.session.id, 0, controller.signal);
	const iterator = events[Symbol.asyncIterator]();
	const next = iterator.next();
	await Bun.sleep(1);
	controller.abort();

	expect(
		await Promise.race([
			next,
			Bun.sleep(100).then(() => "event stream timed out" as const),
		]),
	).toEqual({ value: undefined, done: true });
	server.server.close();
	await sessions.shutdown();
	await rm(managerDir, { recursive: true, force: true });
});

test("an errored worker releases its Workflow and preserves its summary", async () => {
	let worker: SessionChildProcess | undefined;
	const sessions = manager({
		onSpawn: (_path, spawned) => {
			worker = spawned;
		},
	});
	const failed = await sessions.start({
		cwd: "/repo",
		workflowPath: "/repo/WORKFLOW.md",
	});

	worker?.kill("SIGKILL");
	await waitFor(
		async () => (await sessions.get(failed.session.id))?.state === "error",
	);
	const historical = await sessions.get(failed.session.id);
	expect(historical).toMatchObject({
		state: "error",
		historyPath: "/repo/WORKFLOW.md.jsonl",
	});

	const restarted = await sessions.start({
		cwd: "/repo",
		workflowPath: "/repo/WORKFLOW.md",
	});
	expect(restarted.session.id).not.toBe(failed.session.id);
	await sessions.shutdown();
});
