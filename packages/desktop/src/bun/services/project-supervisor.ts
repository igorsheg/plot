import { Effect, Fiber, Layer, PubSub, Queue, Ref, ServiceMap, Stream } from "effect";
import type { ProjectCommand } from "./project-command";
import { spawnProcess, pollHealth, connectSSE, watchExit } from "./project-actor";
import { Projects } from "./projects";
import { BinaryResolver } from "./binary-resolver";
import { PortAllocator } from "./port-allocator";
import { SupervisorError } from "./errors";
import type { ProjectStatus } from "../../shared/rpc";

type ProjectRuntime = {
	readonly mailbox: Queue.Queue<ProjectCommand>;
	readonly fiber: Fiber.Fiber<void, never>;
};

export type ProjectStatusEvent = {
	readonly projectId: string;
	readonly status: ProjectStatus;
	readonly agentCount: number;
	readonly error?: string;
};

export type SnapshotEvent = {
	readonly projectId: string;
	readonly snapshot: unknown;
};

type ProjectState = {
	readonly status: ProjectStatus;
	readonly agentCount: number;
	readonly error?: string;
	readonly port: number;
};

export class ProjectSupervisor extends ServiceMap.Service<ProjectSupervisor>()("ProjectSupervisor", {
	make: Effect.gen(function* () {
		const projects = yield* Projects;
		const binary = yield* BinaryResolver;
		const ports = yield* PortAllocator;

		const runtimesRef = yield* Ref.make(new Map<string, ProjectRuntime>());
		const statesRef = yield* Ref.make(new Map<string, ProjectState>());
		const statusPubSub = yield* PubSub.bounded<ProjectStatusEvent>(256);
		const snapshotPubSub = yield* PubSub.bounded<SnapshotEvent>(256);

		const updateState = (projectId: string, fn: (s: ProjectState) => ProjectState) =>
			Effect.gen(function* () {
				const current = yield* Ref.get(statesRef);
				const prev = current.get(projectId) ?? { status: "idle", agentCount: 0, port: 0 };
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

				const port = yield* ports.allocate;
				const args = yield* binary.resolveArgs;
				const proc = yield* spawnProcess([...args, "serve", "--port", String(port)], project.path);
				const mailbox = yield* Queue.bounded<ProjectCommand>(64);

				yield* updateState(projectId, () => ({ status: "launching", agentCount: 0, port }));

				const handle = (command: ProjectCommand): Effect.Effect<void> => {
					switch (command._tag) {
						case "start":
							return Effect.void;

						case "health_ok":
							return Effect.gen(function* () {
								yield* updateState(projectId, (s) => ({ ...s, status: "connecting" }));
								yield* Effect.forkDetach(connectSSE(port, mailbox));
							});

						case "snapshot": {
							const parsed = command.snapshot as { running?: ReadonlyArray<unknown> };
							const agentCount = parsed.running?.length ?? 0;
							return Effect.gen(function* () {
								yield* updateState(projectId, (s) => ({
									...s,
									status: s.status === "connecting" ? "streaming" : s.status,
									agentCount,
								}));
								yield* PubSub.publish(snapshotPubSub, { projectId, snapshot: command.snapshot });
							});
						}

						case "health_failed":
							return updateState(projectId, (s) => ({ ...s, status: "failed", error: command.error }));

						case "sse_failed":
							return updateState(projectId, (s) => ({
								...s,
								status: s.status === "streaming" ? "failed" : s.status,
								error: "SSE connection lost",
							}));

						case "exit":
							return Effect.gen(function* () {
								const status: ProjectStatus =
									command.code === 0 || command.code === null ? "stopped" : "failed";
								yield* updateState(projectId, () => ({
									status,
									agentCount: 0,
									error: status === "failed" ? `Process exited with code ${command.code}` : undefined,
									port,
								}));
								yield* ports.release(port);
								yield* Ref.update(runtimesRef, (m) => {
									const next = new Map(m);
									next.delete(projectId);
									return next;
								});
							});

						case "stop":
							return Effect.gen(function* () {
								yield* updateState(projectId, (s) => ({ ...s, status: "stopping" }));
								yield* Effect.sync(() => {
									if (!proc.killed) proc.kill();
								});
							});
					}
				};

				const commandLoop = Effect.gen(function* () {
					while (true) {
						const command = yield* Queue.take(mailbox);
						yield* handle(command);
					}
				});

				const actor = Effect.scoped(
					Effect.gen(function* () {
						yield* Effect.forkScoped(watchExit(proc, mailbox));
						yield* Effect.forkScoped(pollHealth(port, mailbox));
						yield* commandLoop;
					}),
				);

				const fiber = yield* Effect.forkDetach(actor);

				yield* Ref.update(runtimesRef, (m) => {
					const next = new Map(m);
					next.set(projectId, { mailbox, fiber });
					return next;
				});
			});

		const stop = (projectId: string) =>
			Effect.gen(function* () {
				const runtimes = yield* Ref.get(runtimesRef);
				const rt = runtimes.get(projectId);
				if (!rt) return;
				yield* Queue.offer(rt.mailbox, { _tag: "stop", reason: "user" });
				yield* Fiber.await(rt.fiber).pipe(Effect.timeout("10 seconds"), Effect.ignore);
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
			for (const [id] of runtimes) {
				yield* stop(id);
			}
		});

		const getState = (projectId: string) =>
			Effect.map(Ref.get(statesRef), (m) =>
				m.get(projectId) ?? { status: "idle" as const, agentCount: 0, port: 0 },
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
		Layer.provide(BinaryResolver.layer),
		Layer.provide(PortAllocator.layer),
	);
}
