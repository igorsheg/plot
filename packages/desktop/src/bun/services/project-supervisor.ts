import { existsSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";

import { Effect, Fiber, Layer, PubSub, Queue, Ref, ServiceMap, Stream } from "effect";
import { ProjectCommand } from "./project-command";
import { Projects } from "./projects";
import { SupervisorError } from "./errors";
import type { ProjectStatus, ProjectSnapshot } from "../../shared/rpc";

function resolveWorkerUrl(): URL {
	const workerPath = process.env["PLOT_WORKER_PATH"];
	if (workerPath && existsSync(workerPath)) {
		return new URL(`file://${workerPath}`);
	}
	const cliEntry = process.env["PLOT_CLI_ENTRY"];
	if (cliEntry) {
		const derived = path.resolve(path.dirname(cliEntry), "../tui-worker.ts");
		if (existsSync(derived)) return new URL(`file://${derived}`);
	}
	const relative = path.resolve(import.meta.dirname, "../../../../plot/src/tui-worker.ts");
	if (existsSync(relative)) return new URL(`file://${relative}`);
	throw new Error("Could not resolve orchestrator worker. Set PLOT_WORKER_PATH or PLOT_CLI_ENTRY.");
}

function buildWorkerEnv(workflowPath: string, logPath: string): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [k, v] of Object.entries(process.env)) {
		if (v !== undefined) env[k] = v;
	}
	return {
		...env,
		PLOT_WORKFLOW: workflowPath,
		PLOT_PORT: "0",
		PLOT_LOG_FORMAT: "json",
		PLOT_LOG_LEVEL: "info",
		PLOT_WEB_ENABLED: "0",
		PLOT_WEB_DIST_DIR: "",
		PLOT_TUI_SERVER_LOG_PATH: logPath,
	};
}

function mapToProjectSnapshot(raw: unknown): ProjectSnapshot | null {
	if (!raw || typeof raw !== "object") return null;
	const obj = raw as Record<string, unknown>;
	const running = Array.isArray(obj.running) ? obj.running.map((r: any) => ({
		issueId: r.issueId ?? "",
		issueIdentifier: r.issueIdentifier ?? "",
		state: r.state ?? "",
		startedAt: r.startedAt ?? "",
		workspacePath: r.workspacePath ?? null,
		session: {
			sessionId: r.session?.sessionId ?? "",
			turnCount: r.session?.turnCount ?? 0,
			phase: r.session?.phase ?? "idle",
			inputTokens: r.session?.inputTokens ?? 0,
			outputTokens: r.session?.outputTokens ?? 0,
			totalTokens: r.session?.totalTokens ?? 0,
			activeTools: r.session?.activeTools ?? [],
			lastMessage: r.session?.lastMessage ?? null,
		},
	})) : [];
	const retrying = Array.isArray(obj.retrying) ? obj.retrying.map((r: any) => ({
		issueId: r.issueId ?? "",
		identifier: r.identifier ?? "",
		attempt: r.attempt ?? 0,
		dueAt: r.dueAt ?? "",
		error: r.error ?? null,
	})) : [];
	const totals = (obj.codexTotals as any) ?? {};
	return {
		generatedAt: (obj.generatedAt as string) ?? new Date().toISOString(),
		running,
		retrying,
		totals: {
			inputTokens: totals.inputTokens ?? 0,
			outputTokens: totals.outputTokens ?? 0,
			totalTokens: totals.totalTokens ?? 0,
			secondsRunning: totals.secondsRunning ?? 0,
		},
	};
}

type ProjectRuntime = {
	readonly mailbox: Queue.Queue<ProjectCommand>;
	readonly fiber: Fiber.Fiber<void, never>;
	readonly worker: Worker;
};

export type ProjectStatusEvent = {
	readonly projectId: string;
	readonly status: ProjectStatus;
	readonly agentCount: number;
	readonly error?: string;
};

export type SnapshotEvent = {
	readonly projectId: string;
	readonly snapshot: ProjectSnapshot;
};

type ProjectState = {
	readonly status: ProjectStatus;
	readonly agentCount: number;
	readonly error?: string;
};

export class ProjectSupervisor extends ServiceMap.Service<ProjectSupervisor>()("ProjectSupervisor", {
	make: Effect.gen(function* () {
		const projects = yield* Projects;

		const runtimesRef = yield* Ref.make(new Map<string, ProjectRuntime>());
		const statesRef = yield* Ref.make(new Map<string, ProjectState>());
		const statusPubSub = yield* PubSub.bounded<ProjectStatusEvent>(256);
		const snapshotPubSub = yield* PubSub.bounded<SnapshotEvent>(256);

		let cachedWorkerUrl: URL | null = null;
		const getWorkerUrl = () => {
			if (!cachedWorkerUrl) cachedWorkerUrl = resolveWorkerUrl();
			return cachedWorkerUrl;
		};

		const updateState = (projectId: string, fn: (s: ProjectState) => ProjectState) =>
			Effect.gen(function* () {
				const current = yield* Ref.get(statesRef);
				const prev = current.get(projectId) ?? { status: "idle", agentCount: 0 };
				const next = fn(prev);
				const updated = new Map(current);
				updated.set(projectId, next);
				yield* Ref.set(statesRef, updated);
				yield* PubSub.publish(statusPubSub, {
					projectId,
					status: next.status,
					agentCount: next.agentCount,
					error: next.error,
				});
			});

		const start = (projectId: string) =>
			Effect.gen(function* () {
				const runtimes = yield* Ref.get(runtimesRef);
				if (runtimes.has(projectId)) return;

				const project = yield* projects.get(projectId);
				if (!project) {
					return yield* new SupervisorError({
						code: "not_found",
						message: `Project ${projectId} not found`,
						projectId,
					});
				}

				const workerUrl = yield* Effect.try({
					try: () => getWorkerUrl(),
					catch: (e) => new SupervisorError({
						code: "worker_resolve_failed",
						message: e instanceof Error ? e.message : String(e),
						projectId,
					}),
				});

				const workflowPath = path.join(project.path, "WORKFLOW.md");
				const logPath = path.join(homedir(), ".plot", "logs", `desktop-${projectId}.log`);
				const env = buildWorkerEnv(workflowPath, logPath);
				const mailbox = yield* Queue.bounded<ProjectCommand>(64);

				const worker = yield* Effect.sync(() => new Worker(workerUrl, { type: "module" }));

				worker.onmessage = (event: MessageEvent) => {
					const msg = event.data as { type: string; snapshot?: unknown; event?: unknown; error?: string };
					switch (msg.type) {
						case "ready":
							Queue.offerUnsafe(mailbox, ProjectCommand.Start());
							break;
						case "snapshot":
							Queue.offerUnsafe(mailbox, ProjectCommand.Snapshot({ snapshot: msg.snapshot }));
							break;
						case "stopped":
							Queue.offerUnsafe(mailbox, ProjectCommand.Exit({ code: 0 }));
							break;
						case "error":
							Queue.offerUnsafe(mailbox, ProjectCommand.StartupError({
								error: { tag: "WorkerError", message: msg.error ?? "Unknown worker error" },
							}));
							break;
					}
				};

				worker.onerror = (_errorEvent: ErrorEvent) => {
					Queue.offerUnsafe(mailbox, ProjectCommand.Exit({ code: 1 }));
				};

				yield* updateState(projectId, () => ({ status: "launching", agentCount: 0 }));

				yield* Effect.sync(() => worker.postMessage({ type: "start", env }));

				const handle = (command: ProjectCommand): Effect.Effect<void> => {
					switch (command._tag) {
						case "Start":
							return updateState(projectId, (s) => ({ ...s, status: "streaming" }));

						case "Snapshot": {
							const parsed = mapToProjectSnapshot(command.snapshot);
							const agentCount = parsed?.running?.length ?? 0;
							return Effect.gen(function* () {
								yield* updateState(projectId, (s) => ({
									...s,
									status: s.status === "launching" ? "streaming" : s.status,
									agentCount,
								}));
								if (parsed) {
									yield* PubSub.publish(snapshotPubSub, { projectId, snapshot: parsed });
								}
							});
						}

						case "StartupError": {
							const message = command.error.pluginName
								? `Plugin "${command.error.pluginName}" failed: ${command.error.message}`
								: command.error.message;
							return updateState(projectId, (s) => ({ ...s, status: "failed", error: message }));
						}

						case "Stop":
							return Effect.gen(function* () {
								yield* updateState(projectId, (s) => ({ ...s, status: "stopping" }));
								yield* Effect.sync(() => {
									worker.postMessage({ type: "stop" });
								});
							});

						case "Exit": {
							const status: ProjectStatus =
								command.code === 0 || command.code === null ? "stopped" : "failed";
							return updateState(projectId, () => ({
								status,
								agentCount: 0,
								error: status === "failed" ? `Worker exited with code ${command.code}` : undefined,
							}));
						}
					}
				};

				const commandLoop = Effect.gen(function* () {
					let alive = true;
					while (alive) {
						const command = yield* Queue.take(mailbox);
						yield* handle(command);
						if (command._tag === "Exit") alive = false;
					}
				});

				const actor = Effect.scoped(
					Effect.gen(function* () {
						yield* Effect.addFinalizer(() =>
							Effect.gen(function* () {
								yield* Effect.sync(() => worker.terminate());
								yield* Ref.update(runtimesRef, (m) => {
									const next = new Map(m);
									next.delete(projectId);
									return next;
								});
							}),
						);
						yield* commandLoop;
					}),
				);

				const fiber = yield* Effect.forkDetach(actor);

				yield* Ref.update(runtimesRef, (m) => {
					const next = new Map(m);
					next.set(projectId, { mailbox, fiber, worker });
					return next;
				});
			});

		const stop = (projectId: string) =>
			Effect.gen(function* () {
				const runtimes = yield* Ref.get(runtimesRef);
				const rt = runtimes.get(projectId);
				if (!rt) return;
				yield* Queue.offer(rt.mailbox, ProjectCommand.Stop({ reason: "user" }));
				const awaited = yield* Fiber.await(rt.fiber).pipe(
					Effect.timeout("10 seconds"),
					Effect.option,
				);
				if (awaited._tag === "None") {
					yield* Fiber.interrupt(rt.fiber);
				}
				yield* updateState(projectId, () => ({ status: "stopped", agentCount: 0 }));
			});

		const startAll = Effect.gen(function* () {
			const all = yield* projects.list;
			const runtimes = yield* Ref.get(runtimesRef);
			for (const p of all) {
				if (!runtimes.has(p.id)) yield* start(p.id);
			}
		});

		const stopAll = Effect.gen(function* () {
			const runtimes = yield* Ref.get(runtimesRef);
			yield* Effect.forEach(
				[...runtimes.keys()],
				(id) => stop(id),
				{ concurrency: "unbounded" },
			);
		});

		const getState = (projectId: string) =>
			Effect.map(Ref.get(statesRef), (m) =>
				m.get(projectId) ?? { status: "idle" as const, agentCount: 0 },
			);

		return {
			start,
			stop,
			startAll,
			stopAll,
			shutdown: stopAll,
			getState,
			statusStream: Stream.fromPubSub(statusPubSub),
			snapshotStream: Stream.fromPubSub(snapshotPubSub),
		};
	}),
}) {
	static layer = Layer.effect(this, this.make).pipe(
		Layer.provide(Projects.layer),
	);
}
