import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { PlotBoundaryError } from "@plot/common/boundary-error";
import { createSessionEventLogWriter } from "@plot/session/history";
import type { RuntimeEvent } from "@plot/session/runtime";
import type { SessionWorkerRecord } from "@plot/session/worker";
import {
	createSessionManagerClient,
	SessionManagerIdentityError,
	sessionManagerProtocolVersion,
	startSessionManagerServer,
} from "../src/ipc.js";
import {
	SessionManager,
	SessionNotControllableError,
	SessionNotFoundError,
	type SessionManagerClient,
} from "../src/manager.js";
import type {
	SessionChildExit,
	SessionChildProcess,
} from "../src/session-process.js";
import { createMemorySessionStore } from "../src/session-store.js";

interface FakeWorker extends SessionChildProcess {
	readonly signals: NodeJS.Signals[];
	readonly exit: (exit?: SessionChildExit) => void;
	readonly ready: () => void;
	readonly emit: (event: RuntimeEvent) => void;
}

const fakeWorker = (input: {
	readonly sessionId: string;
	readonly workflowPath: string;
	readonly ready?: boolean;
	readonly exitOnShutdown?: boolean;
}): FakeWorker => {
	const stdout = new ReadableStream({ start() {} });
	const stderr = new ReadableStream({ start() {} });
	const signals: NodeJS.Signals[] = [];
	const messages: SessionWorkerRecord[] = [];
	let receive: ((message: unknown) => void) | undefined;
	let resolveExited!: (exit: SessionChildExit) => void;
	let didExit = false;
	const exited = new Promise<SessionChildExit>((resolve) => {
		resolveExited = resolve;
	});
	const exit = (result: SessionChildExit = { code: 0, signal: null }) => {
		if (didExit) return;
		didExit = true;
		resolveExited(result);
	};
	const respond = (record: SessionWorkerRecord) => {
		if (receive === undefined) messages.push(record);
		else receive(record);
	};
	const ready = () =>
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
	if (input.ready !== false) ready();
	return {
		stdout,
		stderr,
		signals,
		ready,
		exit,
		emit: (event) => respond({ kind: "event", event }),
		send: (command) => {
			respond({ kind: "result", id: command.id, ok: true, value: true });
			if (command.action === "shutdown" && input.exitOnShutdown !== false)
				queueMicrotask(exit);
		},
		onMessage: (listener) => {
			receive = listener;
			for (const message of messages) receive(message);
			messages.length = 0;
			return () => {
				receive = undefined;
			};
		},
		kill: (signal) => {
			signals.push(signal);
			exit({ code: null, signal });
		},
		exited,
	};
};

const manager = (input?: {
	readonly canonicalize?: (path: string) => Promise<string>;
	onSpawn?: (path: string, worker: FakeWorker) => void;
	spawnChild?: (input: {
		readonly command: string;
		readonly args: readonly string[];
		readonly cwd: string;
	}) => SessionChildProcess;
	readyTimeoutMs?: number;
	gracefulShutdownMs?: number;
}) =>
	new SessionManager({
		store: createMemorySessionStore(),
		cli: { command: "plot", args: [] },
		canonicalize: input?.canonicalize ?? (async (path) => path),
		spawnChild:
			input?.spawnChild ??
			(({ args }) => {
				const sessionId = args[args.indexOf("--session-id") + 1]!;
				const workflowPath = args[args.indexOf("--workflow") + 1]!;
				const worker = fakeWorker({ sessionId, workflowPath });
				input?.onSpawn?.(workflowPath, worker);
				return worker;
			}),
		readyTimeoutMs: input?.readyTimeoutMs ?? 10_000,
		gracefulShutdownMs: input?.gracefulShutdownMs ?? 10,
	});

const waitFor = async (predicate: () => Promise<boolean>): Promise<void> => {
	for (let attempt = 0; attempt < 100; attempt++) {
		// eslint-disable-next-line no-await-in-loop -- bounded asynchronous state polling.
		if (await predicate()) return;
		// eslint-disable-next-line no-await-in-loop -- bounded asynchronous state polling.
		await Bun.sleep(1);
	}
	throw new Error("condition was not met");
};

interface ManagerContractHarness {
	readonly manager: SessionManagerClient;
	readonly cleanup: () => Promise<void>;
}

type ConnectManager = (
	owner: SessionManager,
) => Promise<ManagerContractHarness>;

const workerFromArgs = (
	args: readonly string[],
	options: { readonly ready?: boolean; readonly exitOnShutdown?: boolean } = {},
): FakeWorker =>
	fakeWorker({
		sessionId: args[args.indexOf("--session-id") + 1]!,
		workflowPath: args[args.indexOf("--workflow") + 1]!,
		...options,
	});

const runtimeEvent = (sessionId: string, sequence: number): RuntimeEvent => ({
	kind: "session_event",
	sessionId,
	sequence,
	timestamp: "2026-01-01T00:00:00.000Z",
	event: { type: "tick_started", tickId: sequence },
});

const defineManagerContract = (name: string, connect: ConnectManager) => {
	describe(`${name} Session Manager contract`, () => {
		test("starts one Session and stops it idempotently", async () => {
			const harness = await connect(manager());
			try {
				const [first, second] = await Promise.all([
					harness.manager.start({
						cwd: "/repo",
						workflowPath: "/repo/WORKFLOW.md",
					}),
					harness.manager.start({
						cwd: "/repo",
						workflowPath: "/repo/WORKFLOW.md",
					}),
				]);
				expect(first.session.id).toBe(second.session.id);
				expect([first.started, second.started].filter(Boolean)).toHaveLength(1);
				const [stopped, same] = await Promise.all([
					harness.manager.stop("/repo/WORKFLOW.md"),
					harness.manager.stop("/repo/WORKFLOW.md"),
				]);
				expect(stopped?.state).toBe("stopped");
				expect(same?.id).toBe(stopped?.id);
			} finally {
				await harness.cleanup();
			}
		});

		test("releases the Workflow before a fresh start", async () => {
			const harness = await connect(manager());
			try {
				const first = await harness.manager.start({
					cwd: "/repo",
					workflowPath: "/repo/WORKFLOW.md",
				});
				await harness.manager.stop("/repo/WORKFLOW.md");
				const second = await harness.manager.start({
					cwd: "/repo",
					workflowPath: "/repo/WORKFLOW.md",
				});
				expect(second.started).toBe(true);
				expect(second.session.id).not.toBe(first.session.id);
			} finally {
				await harness.cleanup();
			}
		});

		test("stops a Session whose start is in flight", async () => {
			let worker!: FakeWorker;
			const owner = manager({
				spawnChild: ({ args }) => {
					worker = workerFromArgs(args, { ready: false });
					return worker;
				},
			});
			const harness = await connect(owner);
			try {
				const starting = harness.manager.start({
					cwd: "/repo",
					workflowPath: "/repo/WORKFLOW.md",
				});
				await waitFor(async () => worker !== undefined);
				const stopping = harness.manager.stop("/repo/WORKFLOW.md");
				worker.ready();
				expect((await starting).started).toBe(true);
				expect((await stopping)?.state).toBe("stopped");
			} finally {
				await harness.cleanup();
			}
		});

		test("starts a fresh Session after an in-flight stop", async () => {
			const workers: FakeWorker[] = [];
			const owner = manager({
				spawnChild: ({ args }) => {
					const worker = workerFromArgs(args, {
						exitOnShutdown: workers.length > 0,
					});
					workers.push(worker);
					return worker;
				},
				gracefulShutdownMs: 1_000,
			});
			const harness = await connect(owner);
			try {
				const first = await harness.manager.start({
					cwd: "/repo",
					workflowPath: "/repo/WORKFLOW.md",
				});
				const stopping = harness.manager.stop("/repo/WORKFLOW.md");
				await waitFor(
					async () =>
						(await harness.manager.get(first.session.id))?.state === "stopping",
				);
				const restarting = harness.manager.start({
					cwd: "/repo",
					workflowPath: "/repo/WORKFLOW.md",
				});
				workers[0]!.exit();
				expect((await stopping)?.state).toBe("stopped");
				const second = await restarting;
				expect(second.started).toBe(true);
				expect(second.session.id).not.toBe(first.session.id);
			} finally {
				await harness.cleanup();
			}
		});

		test("rejects controls while stopping", async () => {
			let worker!: FakeWorker;
			const owner = manager({
				spawnChild: ({ args }) => {
					worker = workerFromArgs(args, { exitOnShutdown: false });
					return worker;
				},
				gracefulShutdownMs: 1_000,
			});
			const harness = await connect(owner);
			try {
				const active = await harness.manager.start({
					cwd: "/repo",
					workflowPath: "/repo/WORKFLOW.md",
				});
				const stopping = harness.manager.stop("/repo/WORKFLOW.md");
				await waitFor(
					async () =>
						(await harness.manager.get(active.session.id))?.state ===
						"stopping",
				);
				let failure: unknown;
				try {
					await harness.manager.tick(active.session.id);
				} catch (error) {
					failure = error;
				}
				expect(failure).toBeInstanceOf(SessionNotControllableError);
				expect(failure).toMatchObject({
					code: "session_not_controllable",
					context: { state: "stopping", operation: "tick" },
				});
				worker.exit();
				await stopping;
			} finally {
				await harness.cleanup();
			}
		});

		test("leaves no Session after pre-ready failure", async () => {
			const owner = manager({
				readyTimeoutMs: 5,
				spawnChild: ({ args }) => workerFromArgs(args, { ready: false }),
			});
			const harness = await connect(owner);
			try {
				let failure: unknown;
				try {
					await harness.manager.start({
						cwd: "/repo",
						workflowPath: "/repo/WORKFLOW.md",
					});
				} catch (error) {
					failure = error;
				}
				expect(failure).toMatchObject({ code: "worker_command_timeout" });
				expect(await harness.manager.list()).toEqual([]);
			} finally {
				await harness.cleanup();
			}
		});

		test("replays history then follows live events without duplicates", async () => {
			const dir = await mkdtemp(
				join(tmpdir(), "plot-manager-events-contract-"),
			);
			const workflowPath = join(dir, "WORKFLOW.md");
			let worker!: FakeWorker;
			const owner = manager({
				spawnChild: ({ args }) => {
					worker = workerFromArgs(args);
					return worker;
				},
			});
			const harness = await connect(owner);
			try {
				const active = await harness.manager.start({ cwd: dir, workflowPath });
				const first = runtimeEvent(active.session.id, 1);
				const log = createSessionEventLogWriter(active.session.historyPath);
				await log.append(first);
				await log.close();
				const controller = new AbortController();
				const events = harness.manager.events(
					active.session.id,
					0,
					controller.signal,
				);
				const iterator = events[Symbol.asyncIterator]();
				expect((await iterator.next()).value?.sequence).toBe(1);
				worker.emit(first);
				worker.emit(runtimeEvent(active.session.id, 2));
				expect((await iterator.next()).value?.sequence).toBe(2);
				controller.abort();
				await iterator.return?.();
			} finally {
				await harness.cleanup();
				await rm(dir, { recursive: true, force: true });
			}
		});

		test("preserves tagged owner errors", async () => {
			const harness = await connect(manager());
			try {
				let failure: unknown;
				try {
					await harness.manager.tick("missing");
				} catch (error) {
					failure = error;
				}
				expect(failure).toBeInstanceOf(PlotBoundaryError);
				expect(failure).toBeInstanceOf(SessionNotFoundError);
				expect(failure).toMatchObject({
					code: "session_not_found",
					context: { sessionId: "missing" },
				});
			} finally {
				await harness.cleanup();
			}
		});
	});
};

defineManagerContract("direct", async (owner) => ({
	manager: owner,
	cleanup: () => owner.shutdown(),
}));

defineManagerContract("IPC", async (owner) => {
	const managerDir = await mkdtemp(join(tmpdir(), "plot-manager-contract-"));
	const server = await startSessionManagerServer({
		options: { managerDir },
		manager: owner,
	});
	return {
		manager: createSessionManagerClient({ managerDir }),
		cleanup: async () => {
			await server.close();
			await owner.shutdown();
			await rm(managerDir, { recursive: true, force: true });
		},
	};
});

test("equivalent Workflow aliases share one lifecycle slot", async () => {
	let spawns = 0;
	const sessions = manager({
		canonicalize: async () => "/repo/WORKFLOW.md",
		onSpawn: () => spawns++,
	});

	const [first, second] = await Promise.all([
		sessions.start({ cwd: "/repo", workflowPath: "WORKFLOW.md" }),
		sessions.start({ cwd: "/repo", workflowPath: "./WORKFLOW.md" }),
	]);

	expect(spawns).toBe(1);
	expect(first.session.id).toBe(second.session.id);
	expect(first.session.workflowAliases).toContain("/repo/WORKFLOW.md");
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

test("stop still finds a Session after its Workflow alias disappears", async () => {
	let exists = true;
	const sessions = manager({
		canonicalize: async (path) => {
			if (!exists) {
				const error = new Error("missing") as NodeJS.ErrnoException;
				error.code = "ENOENT";
				throw error;
			}
			return path === "/linked/WORKFLOW.md" ||
				path === "/another-link/WORKFLOW.md"
				? "/real/WORKFLOW.md"
				: path;
		},
	});
	await sessions.start({ cwd: "/linked", workflowPath: "WORKFLOW.md" });
	const attached = await sessions.start({
		cwd: "/another-link",
		workflowPath: "WORKFLOW.md",
	});
	expect(attached.session.workflowAliases).toContain(
		"/another-link/WORKFLOW.md",
	);
	exists = false;
	expect((await sessions.stop("/another-link/WORKFLOW.md"))?.state).toBe(
		"stopped",
	);
});

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
	await server.close();
	await sessions.shutdown();
	await rm(managerDir, { recursive: true, force: true });
});

test("unknown event streams preserve session_not_found through IPC", async () => {
	const managerDir = await mkdtemp(join(tmpdir(), "plot-manager-events-"));
	const sessions = manager();
	const server = await startSessionManagerServer({
		options: { managerDir },
		manager: sessions,
	});
	try {
		const events = createSessionManagerClient({ managerDir }).events("missing");
		const iterator = events[Symbol.asyncIterator]();
		await expect(iterator.next()).rejects.toMatchObject({
			code: "session_not_found",
		});
	} finally {
		await server.close();
		await sessions.shutdown();
		await rm(managerDir, { recursive: true, force: true });
	}
});

test("a client rejects a Session Manager from another Plot build", async () => {
	const managerDir = await mkdtemp(join(tmpdir(), "plot-manager-identity-"));
	const sessions = manager();
	const server = await startSessionManagerServer({
		options: { managerDir, identity: "daemon-build" },
		manager: sessions,
	});
	try {
		const client = createSessionManagerClient({
			managerDir,
			identity: "client-build",
		});
		await expect(client.list()).rejects.toBeInstanceOf(
			SessionManagerIdentityError,
		);
		await expect(client.list()).rejects.toThrow(
			`client ${sessionManagerProtocolVersion}/client-build, daemon ${sessionManagerProtocolVersion}/daemon-build`,
		);
	} finally {
		await server.close();
		await sessions.shutdown();
		await rm(managerDir, { recursive: true, force: true });
	}
});

test("an errored worker releases its Workflow and preserves its summary", async () => {
	let worker: FakeWorker | undefined;
	const sessions = manager({
		onSpawn: (_path, spawned) => {
			worker = spawned;
		},
	});
	const failed = await sessions.start({
		cwd: "/repo",
		workflowPath: "/repo/WORKFLOW.md",
	});
	worker?.exit({ code: null, signal: "SIGKILL" });
	await waitFor(
		async () => (await sessions.get(failed.session.id))?.state === "error",
	);
	expect(await sessions.get(failed.session.id)).toMatchObject({
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

test("IPC preserves session_not_controllable after stop", async () => {
	const managerDir = await mkdtemp(
		join(tmpdir(), "plot-manager-control-error-"),
	);
	const sessions = manager();
	const server = await startSessionManagerServer({
		options: { managerDir },
		manager: sessions,
	});
	try {
		const client = createSessionManagerClient({ managerDir });
		const active = await client.start({
			cwd: "/repo",
			workflowPath: "/repo/WORKFLOW.md",
		});
		await client.stop("/repo/WORKFLOW.md");
		let failure: unknown;
		try {
			await client.tick(active.session.id);
		} catch (error) {
			failure = error;
		}
		expect(failure).toBeInstanceOf(SessionNotControllableError);
		expect(failure).toMatchObject({
			code: "session_not_controllable",
			context: {
				sessionId: active.session.id,
				state: "stopped",
				operation: "tick",
			},
		});
	} finally {
		await server.close();
		await sessions.shutdown();
		await rm(managerDir, { recursive: true, force: true });
	}
});

test("direct unknown Session errors retain their concrete owner class", async () => {
	const sessions = manager();
	await expect(sessions.tick("missing")).rejects.toBeInstanceOf(
		SessionNotFoundError,
	);
});
