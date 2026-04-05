import { existsSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";

import { Effect, Fiber, Layer, PubSub, Queue, Ref, ServiceMap, Stream } from "effect";
import { ProjectCommand } from "./project-command";
import { Projects } from "./projects";
import { SupervisorError } from "./errors";
import type { ProjectStatus, ProjectSnapshot } from "../../shared/rpc";
import type { RuntimeSnapshot } from "@plot/sdk";

function resolvePlotBinary(): string[] {
	const cliEntry = process.env["PLOT_CLI_ENTRY"];
	if (cliEntry && existsSync(cliEntry)) {
		return [process.execPath, cliEntry];
	}
	const plotBin = path.resolve(import.meta.dirname, "../../../../plot/src/cli/index.ts");
	if (existsSync(plotBin)) {
		return [process.execPath, plotBin];
	}
	throw new Error("Could not resolve plot-ai binary. Set PLOT_CLI_ENTRY.");
}

function buildSubprocessEnv(workflowPath: string, logPath: string): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [k, v] of Object.entries(process.env)) {
		if (v !== undefined) env[k] = v;
	}
	return {
		...env,
		PLOT_WORKFLOW: workflowPath,
		
		PLOT_LOG_FORMAT: "json",
		PLOT_LOG_LEVEL: "info",
		PLOT_WEB_ENABLED: "0",
	};
}

function mapToProjectSnapshot(raw: unknown): ProjectSnapshot | null {
	if (!raw || typeof raw !== "object") return null;
	const snapshot = raw as RuntimeSnapshot;
	return {
		generatedAt: snapshot.generatedAt ?? new Date().toISOString(),
		running: (snapshot.running ?? []).map((r) => ({
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
				activeTools: (r.session?.activeTools ?? []).map((t) => ({ toolCallId: t.toolCallId, toolName: t.toolName })),
				lastMessage: r.session?.lastMessage ?? null,
			},
		})),
		retrying: (snapshot.retrying ?? []).map((r) => ({
			issueId: r.issueId ?? "",
			identifier: r.identifier ?? "",
			attempt: r.attempt ?? 0,
			dueAt: r.dueAt ?? "",
			error: r.error ?? null,
		})),
		totals: {
			inputTokens: snapshot.codexTotals?.inputTokens ?? 0,
			outputTokens: snapshot.codexTotals?.outputTokens ?? 0,
			totalTokens: snapshot.codexTotals?.totalTokens ?? 0,
			secondsRunning: snapshot.codexTotals?.secondsRunning ?? 0,
		},
	};
}

async function readNdjsonStream(
	stream: ReadableStream<Uint8Array>,
	onMessage: (msg: unknown) => void,
	onEnd: () => void,
) {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";
			for (const line of lines) {
				if (!line.trim()) continue;
				try {
					onMessage(JSON.parse(line));
				} catch { /* skip malformed */ }
			}
		}
		if (buffer.trim()) {
			try { onMessage(JSON.parse(buffer)); } catch { /* skip */ }
		}
	} catch { /* stream error */ }
	onEnd();
}

function isJsonRpcNotification(msg: unknown): msg is { jsonrpc: "2.0"; method: string; params: unknown } {
	return typeof msg === "object" && msg !== null && "jsonrpc" in msg && "method" in msg;
}

type ProjectRuntime = {
	readonly mailbox: Queue.Queue<ProjectCommand>;
	readonly fiber: Fiber.Fiber<void, never>;
	readonly process: ReturnType<typeof Bun.spawn>;
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

		let cachedCmd: string[] | null = null;
		const getCmd = () => {
			if (!cachedCmd) cachedCmd = resolvePlotBinary();
			return cachedCmd;
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

				const cmd = yield* Effect.try({
					try: () => getCmd(),
					catch: (e) => new SupervisorError({
						code: "worker_resolve_failed",
						message: e instanceof Error ? e.message : String(e),
						projectId,
					}),
				});

				const workflowPath = path.join(project.path, "WORKFLOW.md");
				const logPath = path.join(homedir(), ".plot", "logs", `desktop-${projectId}.log`);
				const env = buildSubprocessEnv(workflowPath, logPath);
				const mailbox = yield* Queue.bounded<ProjectCommand>(64);

				const proc = yield* Effect.sync(() =>
					Bun.spawn([...cmd, "--mode", "rpc"], {
						stdio: ["pipe", "pipe", "pipe"],
						env,
					}),
				);

				let readySent = false;

				readNdjsonStream(
					proc.stdout as ReadableStream<Uint8Array>,
					(msg) => {
						if (!isJsonRpcNotification(msg)) return;
						switch (msg.method) {
							case "state/update": {
								const params = msg.params as { snapshot: unknown };
								if (!readySent) {
									readySent = true;
									Queue.offerUnsafe(mailbox, ProjectCommand.Start());
								}
								Queue.offerUnsafe(mailbox, ProjectCommand.Snapshot({ snapshot: params.snapshot }));
								break;
							}
						}
					},
					() => {
						Queue.offerUnsafe(mailbox, ProjectCommand.Exit({ code: proc.exitCode }));
					},
				);

				// Drain stderr to prevent buffer pressure
				readNdjsonStream(proc.stderr as ReadableStream<Uint8Array>, () => {}, () => {});

				yield* updateState(projectId, () => ({ status: "launching", agentCount: 0 }));

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
									const stopCmd = JSON.stringify({ jsonrpc: "2.0", method: "stop", params: {}, id: Date.now() }) + "\n";
									proc.stdin.write(stopCmd);
									proc.stdin.end();
								});
							});

						case "Exit": {
							const status: ProjectStatus =
								command.code === 0 || command.code === null ? "stopped" : "failed";
							return updateState(projectId, () => ({
								status,
								agentCount: 0,
								error: status === "failed" ? `Process exited with code ${command.code}` : undefined,
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
								yield* Effect.sync(() => {
									if (!proc.killed) proc.kill();
								});
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
					next.set(projectId, { mailbox, fiber, process: proc });
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
