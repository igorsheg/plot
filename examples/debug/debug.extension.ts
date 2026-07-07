import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	DiscoveryUnavailableError,
	definePlotExtension,
	defineTool,
	type OperatorAction,
	type PlotExtensionWork,
} from "plot-ai/sdk";

interface DebugConfig {
	readonly cycleMs: number;
	readonly waveSize: number;
	readonly shortSleepMs: number;
	readonly longSleepMs: number;
	readonly drainAfterMs: number;
	readonly includeFailure: boolean;
	readonly includeTimeout: boolean;
	readonly includeCancellation: boolean;
	readonly includeDrain: boolean;
	readonly simulateDiscoveryFailureEvery: number;
	readonly workspaceRoot?: string;
}

interface DebugLogEntry {
	readonly at: string;
	readonly kind: string;
	readonly workId?: string | undefined;
	readonly version?: string | undefined;
	readonly runId?: string | undefined;
	readonly message?: string | undefined;
}

const DEFAULT_CONFIG: DebugConfig = {
	cycleMs: 90_000,
	waveSize: 6,
	shortSleepMs: 2_500,
	longSleepMs: 45_000,
	drainAfterMs: 8_000,
	includeFailure: true,
	includeTimeout: true,
	includeCancellation: true,
	includeDrain: true,
	simulateDiscoveryFailureEvery: 0,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const numberField = (record: Record<string, unknown>, field: string) =>
	typeof record[field] === "number" ? record[field] : undefined;

const booleanField = (record: Record<string, unknown>, field: string) =>
	typeof record[field] === "boolean" ? record[field] : undefined;

const stringField = (record: Record<string, unknown>, field: string) =>
	typeof record[field] === "string" ? record[field] : undefined;

const positiveInteger = (value: number | undefined, fallback: number) => {
	if (value === undefined) return fallback;
	if (!Number.isInteger(value) || value < 1) return fallback;
	return value;
};

const nonNegativeInteger = (value: number | undefined, fallback: number) => {
	if (value === undefined) return fallback;
	if (!Number.isInteger(value) || value < 0) return fallback;
	return value;
};

const parseConfig = (input: unknown): DebugConfig => {
	const record = isRecord(input) ? input : {};
	const config: DebugConfig = {
		cycleMs: positiveInteger(
			numberField(record, "cycleMs"),
			DEFAULT_CONFIG.cycleMs,
		),
		waveSize: positiveInteger(
			numberField(record, "waveSize"),
			DEFAULT_CONFIG.waveSize,
		),
		shortSleepMs: positiveInteger(
			numberField(record, "shortSleepMs"),
			DEFAULT_CONFIG.shortSleepMs,
		),
		longSleepMs: positiveInteger(
			numberField(record, "longSleepMs"),
			DEFAULT_CONFIG.longSleepMs,
		),
		drainAfterMs: positiveInteger(
			numberField(record, "drainAfterMs"),
			DEFAULT_CONFIG.drainAfterMs,
		),
		includeFailure:
			booleanField(record, "includeFailure") ?? DEFAULT_CONFIG.includeFailure,
		includeTimeout:
			booleanField(record, "includeTimeout") ?? DEFAULT_CONFIG.includeTimeout,
		includeCancellation:
			booleanField(record, "includeCancellation") ??
			DEFAULT_CONFIG.includeCancellation,
		includeDrain:
			booleanField(record, "includeDrain") ?? DEFAULT_CONFIG.includeDrain,
		simulateDiscoveryFailureEvery: nonNegativeInteger(
			numberField(record, "simulateDiscoveryFailureEvery"),
			DEFAULT_CONFIG.simulateDiscoveryFailureEvery,
		),
	};
	const workspaceRoot = stringField(record, "workspaceRoot");
	if (workspaceRoot !== undefined) {
		return { ...config, workspaceRoot };
	}
	return config;
};

const stableKey = (work: Pick<PlotExtensionWork, "id" | "version">) =>
	`${work.id}@${work.version ?? "unversioned"}`;

const safePathSegment = (value: string) =>
	value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "work";

const sleep = (ms: number, signal?: AbortSignal) =>
	new Promise<void>((resolve, reject) => {
		if (signal?.aborted) {
			reject(new Error("debug sleep aborted"));
			return;
		}
		let timeout: ReturnType<typeof setTimeout>;
		const cleanup = () => {
			clearTimeout(timeout);
			signal?.removeEventListener("abort", abort);
		};
		const abort = () => {
			cleanup();
			reject(new Error("debug sleep aborted"));
		};
		timeout = setTimeout(() => {
			cleanup();
			resolve();
		}, ms);
		signal?.addEventListener("abort", abort, { once: true });
	});

const debugContext = (input: {
	readonly scenario: string;
	readonly cycle: number;
	readonly instructions: readonly string[];
	readonly expectedState: string;
}) => JSON.stringify(input, null, 2);

const operatorActions = (): readonly OperatorAction[] => [
	{
		id: "release_once",
		label: "Release once",
		tone: "primary",
		requiresComment: true,
		confirm: {
			title: "Release the blocked debug item?",
			message:
				"The item will become pending for one cycle and then block again.",
		},
	},
	{
		id: "pause_wave",
		label: "Pause wave",
		tone: "secondary",
	},
	{
		id: "resume_wave",
		label: "Resume wave",
		tone: "secondary",
	},
	{
		id: "cancel_live",
		label: "Cancel live work",
		tone: "danger",
		confirm: {
			title: "Cancel synthetic live work?",
			message:
				"The next discovery tick will return cancellable work as cancelled.",
		},
	},
];

export default definePlotExtension<DebugConfig>({
	id: "plot-debug-lab",
	parseConfig,
	create({ config, paths, work: makeWork, registerTool }) {
		const bootMs = Date.now();
		const completedKeys = new Set<string>();
		const startedAt = new Map<string, number>();
		const log: DebugLogEntry[] = [];
		let discoverCount = 0;
		let operatorSequence = 0;
		let releaseSequence = 0;
		let completedReleaseSequence = 0;
		let pauseWave = false;
		let cancelLiveSequence = 0;

		const workspaceRoot =
			config.workspaceRoot ?? join(paths.sessionDir, "debug-workspaces");

		const appendLog = async (entry: DebugLogEntry) => {
			log.unshift(entry);
			log.splice(200);
			await mkdir(workspaceRoot, { recursive: true });
			await appendFile(
				join(workspaceRoot, "extension-events.jsonl"),
				`${JSON.stringify(entry)}\n`,
				"utf8",
			);
		};

		const workspaceFor = (id: string) =>
			join(workspaceRoot, safePathSegment(id));

		const notCompleted = (candidate: PlotExtensionWork) =>
			!completedKeys.has(stableKey(candidate));

		const addWork = (
			items: PlotExtensionWork[],
			candidate: PlotExtensionWork,
		) => {
			if (notCompleted(candidate)) items.push(makeWork(candidate));
		};

		registerTool(({ work, runId }) =>
			defineTool({
				name: "debug_report",
				label: "Debug report",
				description:
					"Record a structured debug checkpoint for this synthetic Work Item.",
				promptSnippet:
					"Use debug_report when a debug scenario asks you to mark a checkpoint.",
				parameters: {
					type: "object",
					properties: {
						message: { type: "string" },
						phase: { type: "string" },
					},
					required: ["message"],
				},
				execute: async (params) => {
					const message =
						typeof params.message === "string" ? params.message : "checkpoint";
					const phase =
						typeof params.phase === "string" ? params.phase : "agent";
					await appendLog({
						at: new Date().toISOString(),
						kind: `tool:${phase}`,
						workId: work.id,
						version: work.version,
						runId,
						message,
					});
					return {
						content: [
							{
								type: "text",
								text: `debug checkpoint recorded for ${work.id}: ${message}`,
							},
						],
						details: {
							workId: work.id,
							version: work.version,
							runId,
							logEntries: log.length,
						},
					};
				},
			}),
		);

		registerTool(({ work, runId }) =>
			defineTool({
				name: "debug_sleep",
				label: "Debug sleep",
				description:
					"Sleep for a requested duration so Plot dashboards can show running, draining, interruption, and timeout states.",
				parameters: {
					type: "object",
					properties: {
						milliseconds: { type: "integer" },
						reason: { type: "string" },
					},
					required: ["milliseconds"],
				},
				execute: async (params, context) => {
					const milliseconds = positiveInteger(
						typeof params.milliseconds === "number"
							? params.milliseconds
							: undefined,
						config.shortSleepMs,
					);
					await appendLog({
						at: new Date().toISOString(),
						kind: "tool:sleep:start",
						workId: work.id,
						version: work.version,
						runId,
						message: `${milliseconds}ms`,
					});
					await sleep(milliseconds, context.signal);
					await appendLog({
						at: new Date().toISOString(),
						kind: "tool:sleep:done",
						workId: work.id,
						version: work.version,
						runId,
					});
					return {
						content: [
							{
								type: "text",
								text: `slept ${milliseconds}ms for ${work.id}`,
							},
						],
					};
				},
			}),
		);

		registerTool(({ work, runId }) =>
			defineTool({
				name: "debug_workspace_note",
				label: "Debug workspace note",
				description:
					"Write a small artifact into this Work Item workspace to test per-work cwd and artifact inspection.",
				parameters: {
					type: "object",
					properties: {
						filename: { type: "string" },
						body: { type: "string" },
					},
					required: ["filename", "body"],
				},
				execute: async (params) => {
					const filename =
						typeof params.filename === "string"
							? safePathSegment(params.filename)
							: "debug-note.txt";
					const body = typeof params.body === "string" ? params.body : "debug";
					const targetWorkspace = work.workspace ?? workspaceFor(work.id);
					await mkdir(targetWorkspace, { recursive: true });
					const target = join(targetWorkspace, filename);
					await writeFile(target, body, "utf8");
					await appendLog({
						at: new Date().toISOString(),
						kind: "tool:workspace_note",
						workId: work.id,
						version: work.version,
						runId,
						message: target,
					});
					return {
						content: [{ type: "text", text: `wrote ${target}` }],
						details: { path: target },
					};
				},
			}),
		);

		registerTool(({ work }) =>
			defineTool({
				name: "debug_finish",
				label: "Debug finish",
				description:
					"End the current synthetic debug run after the requested checkpoints are complete.",
				parameters: {
					type: "object",
					properties: { summary: { type: "string" } },
					required: ["summary"],
				},
				execute: async (params) => {
					const summary =
						typeof params.summary === "string" ? params.summary : "debug done";
					await appendLog({
						at: new Date().toISOString(),
						kind: "tool:finish",
						workId: work.id,
						version: work.version,
						message: summary,
					});
					return {
						content: [{ type: "text", text: summary }],
						terminate: true,
					};
				},
			}),
		);

		return {
			async discover() {
				discoverCount += 1;
				if (
					config.simulateDiscoveryFailureEvery > 0 &&
					discoverCount % config.simulateDiscoveryFailureEvery === 0
				) {
					throw new DiscoveryUnavailableError(
						`synthetic discovery failure on tick ${discoverCount}`,
					);
				}

				const now = Date.now();
				const cycle = Math.floor((now - bootMs) / config.cycleMs);
				const items: PlotExtensionWork[] = [];

				const controlVersion = `operator-${releaseSequence}`;
				const controlBase = {
					id: "debug:operator-control",
					version: controlVersion,
					title: "Operator action control",
					subject: "debug:operators",
					display: {
						kind: "debug",
						primary: "ACTION",
						title: "Operator action control",
						subtitle: `operator sequence ${operatorSequence}`,
						version: controlVersion,
						labels: ["blocked", "actions", pauseWave ? "paused" : "live"],
					},
					context: {
						debugContext: debugContext({
							scenario: "operator action released work",
							cycle,
							expectedState: "pending -> running -> done",
							instructions: [
								"Call debug_report with phase 'operator'.",
								"Call debug_finish with a one-line summary.",
							],
						}),
					},
				} satisfies PlotExtensionWork;
				if (releaseSequence <= completedReleaseSequence) {
					items.push(
						makeWork({
							...controlBase,
							status: "blocked",
							blockedReason:
								"Synthetic blocked item. Use Release once, Pause wave, Resume wave, or Cancel live work from the dashboard.",
							operatorActions: operatorActions(),
						}),
					);
				} else {
					items.push(makeWork(controlBase));
				}

				items.push(
					makeWork({
						id: "debug:waiting-clock",
						version: `wait-${cycle}`,
						title: "Waiting clock",
						subject: "debug:waiting",
						status: "waiting",
						blockedReason:
							"Synthetic waiting state: visible, claimed by the source, not dispatched.",
						display: {
							kind: "debug",
							primary: "WAIT",
							title: "Waiting clock",
							subtitle: `cycle ${cycle}`,
							version: `wait-${cycle}`,
							labels: ["waiting", "held"],
						},
					}),
				);

				if (!pauseWave) {
					for (let index = 1; index <= config.waveSize; index += 1) {
						const version = `wave-${cycle}`;
						addWork(items, {
							id: `debug:wave:${index}`,
							version,
							title: `Queued wave item ${index}`,
							subject: "debug:wave",
							workspace: workspaceFor(`wave-${index}`),
							display: {
								kind: "debug",
								primary: `W${index}`,
								title: `Queued wave item ${index}`,
								subtitle: `cycle ${cycle}; concurrency should leave some pending`,
								version,
								labels: ["pending", "running", "done"],
							},
							context: {
								debugContext: debugContext({
									scenario: "queued/running/done wave",
									cycle,
									expectedState: "pending -> running -> done",
									instructions: [
										"Call debug_report with phase 'start'.",
										`Call debug_sleep for ${config.shortSleepMs} milliseconds.`,
										"Call debug_finish with a short summary.",
									],
								}),
							},
						});
					}
				}

				addWork(items, {
					id: "debug:tool-sampler",
					version: `tools-${cycle}`,
					title: "Tool and workspace sampler",
					subject: "debug:tools",
					workspace: workspaceFor("tool-sampler"),
					display: {
						kind: "debug",
						primary: "TOOL",
						title: "Tool and workspace sampler",
						subtitle:
							"custom tools, details payloads, terminate, workspace artifacts",
						version: `tools-${cycle}`,
						labels: ["tools", "workspace", "terminate"],
					},
					context: {
						debugContext: debugContext({
							scenario: "custom tools and workspace artifacts",
							cycle,
							expectedState: "running with tool timeline -> done",
							instructions: [
								"Call debug_report with phase 'tool-sampler'.",
								"Call debug_workspace_note with filename 'artifact.txt'.",
								`Call debug_sleep for ${config.shortSleepMs} milliseconds.`,
								"Call debug_finish with a summary mentioning the artifact.",
							],
						}),
					},
				});

				if (config.includeDrain) {
					const drain: PlotExtensionWork = {
						id: "debug:drain-on-disappear",
						version: `drain-${cycle}`,
						title: "Drain after disappearing",
						subject: "debug:drain",
						workspace: workspaceFor("drain-on-disappear"),
						display: {
							kind: "debug",
							primary: "DRAIN",
							title: "Drain after disappearing",
							subtitle: "extension omits this work after it starts",
							version: `drain-${cycle}`,
							labels: ["draining", "disappears"],
						},
						context: {
							debugContext: debugContext({
								scenario: "draining when work disappears mid-run",
								cycle,
								expectedState: "running -> draining -> done/released",
								instructions: [
									"Call debug_report with phase 'drain-start'.",
									`Call debug_sleep for ${config.longSleepMs} milliseconds so discovery can omit this item while it is still running.`,
									"Call debug_finish after the sleep if the run was allowed to drain.",
								],
							}),
						},
					};
					const drainStartedAt = startedAt.get(stableKey(drain));
					if (
						drainStartedAt === undefined ||
						now - drainStartedAt < config.drainAfterMs
					) {
						addWork(items, drain);
					}
				}

				if (config.includeCancellation) {
					const cancelBase = {
						id: "debug:cancel-on-command",
						version: `cancel-${cycle}-${cancelLiveSequence}`,
						title: "Cancellation target",
						subject: "debug:cancel",
						workspace: workspaceFor("cancel-on-command"),
						display: {
							kind: "debug",
							primary: "CANCEL",
							title: "Cancellation target",
							subtitle:
								"auto-cancels after start or when operator requests cancellation",
							version: `cancel-${cycle}-${cancelLiveSequence}`,
							labels: ["cancelled", "interrupted"],
						},
						context: {
							debugContext: debugContext({
								scenario: "source cancellation",
								cycle,
								expectedState: "running -> interrupted/removed",
								instructions: [
									"Call debug_report with phase 'cancel-start'.",
									`Call debug_sleep for ${config.longSleepMs} milliseconds.`,
									"If not interrupted, call debug_finish.",
								],
							}),
						},
					} satisfies PlotExtensionWork;
					const cancelStarted = startedAt.has(stableKey(cancelBase));
					if (cancelStarted && !completedKeys.has(stableKey(cancelBase))) {
						addWork(items, { ...cancelBase, status: "cancelled" });
					} else {
						addWork(items, cancelBase);
					}
				}

				if (config.includeFailure) {
					items.push(
						makeWork({
							id: "debug:workspace-failure",
							version: "always-fails",
							title: "Workspace preparation failure",
							subject: "debug:failure",
							workspace: "/dev/null/plot-debug-workspace-failure",
							display: {
								kind: "debug",
								primary: "FAIL",
								title: "Workspace preparation failure",
								subtitle:
									"expected mkdir failure; exercises failed + retry wake",
								version: "always-fails",
								labels: ["failed", "retry", "wake"],
							},
							context: {
								debugContext: debugContext({
									scenario: "runner setup failure",
									cycle,
									expectedState: "failed -> scheduled wake -> retry",
									instructions: [
										"This prompt should not run because workspace creation is expected to fail before agent start.",
									],
								}),
							},
						}),
					);
				}

				if (config.includeTimeout) {
					items.push(
						makeWork({
							id: "debug:timeout-run",
							version: "timeout-loop",
							title: "Timeout target",
							subject: "debug:timeout",
							workspace: workspaceFor("timeout-run"),
							display: {
								kind: "debug",
								primary: "TIME",
								title: "Timeout target",
								subtitle: "long sleep should exceed maxRunDurationMs",
								version: "timeout-loop",
								labels: ["timed_out", "retry", "wake"],
							},
							context: {
								debugContext: debugContext({
									scenario: "max run duration timeout",
									cycle,
									expectedState: "running -> timed_out -> scheduled wake",
									instructions: [
										"Call debug_report with phase 'timeout-start'.",
										`Call debug_sleep for ${config.longSleepMs * 3} milliseconds.`,
										"Do not call debug_finish unless the sleep returns.",
									],
								}),
							},
						}),
					);
				}

				return items;
			},
			async started(event) {
				const key = stableKey(event.work);
				startedAt.set(key, Date.now());
				await appendLog({
					at: new Date().toISOString(),
					kind: "hook:started",
					workId: event.work.id,
					version: event.work.version,
					runId: event.runId,
				});
			},
			async completed(event) {
				const key = stableKey(event.work);
				completedKeys.add(key);
				if (event.work.id === "debug:operator-control") {
					completedReleaseSequence = releaseSequence;
				}
				await appendLog({
					at: new Date().toISOString(),
					kind: "hook:completed",
					workId: event.work.id,
					version: event.work.version,
					runId: event.runId,
				});
			},
			async failed(event) {
				await appendLog({
					at: new Date().toISOString(),
					kind: "hook:failed",
					workId: event.work.id,
					version: event.work.version,
					runId: event.runId,
					message: String(event.error),
				});
			},
			async interrupted(event) {
				completedKeys.add(stableKey(event.work));
				await appendLog({
					at: new Date().toISOString(),
					kind: "hook:interrupted",
					workId: event.work.id,
					version: event.work.version,
					runId: event.runId,
				});
			},
			async timedOut(event) {
				await appendLog({
					at: new Date().toISOString(),
					kind: "hook:timed_out",
					workId: event.work.id,
					version: event.work.version,
					runId: event.runId,
				});
			},
			async operatorAction(event) {
				operatorSequence += 1;
				if (event.actionId === "release_once") releaseSequence += 1;
				if (event.actionId === "pause_wave") pauseWave = true;
				if (event.actionId === "resume_wave") pauseWave = false;
				if (event.actionId === "cancel_live") cancelLiveSequence += 1;
				await appendLog({
					at: event.timestamp,
					kind: `hook:operator:${event.actionId}`,
					workId: event.work.id,
					version: event.work.version,
					message: event.comment,
				});
			},
			async shutdown() {
				await appendLog({
					at: new Date().toISOString(),
					kind: "hook:shutdown",
				});
			},
		};
	},
});
