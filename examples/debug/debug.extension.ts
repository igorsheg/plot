import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	DiscoveryUnavailableError,
	definePlotExtension,
	defineTool,
	type PlotExtensionTool,
	type PlotExtensionWork,
} from "plot-ai/sdk";

interface DebugConfig {
	readonly cycleMs: number;
	readonly stepDelayMs: number;
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

interface DebugScenario {
	readonly id: string;
	readonly primary: string;
	readonly title: string;
	readonly subtitle: string;
	readonly labels: readonly string[];
	readonly objective: string;
	readonly steps: readonly string[];
	readonly artifacts: readonly string[];
}

const DEFAULT_CONFIG: DebugConfig = {
	cycleMs: 15 * 60_000,
	stepDelayMs: 20_000,
	simulateDiscoveryFailureEvery: 0,
};

const SCENARIOS: readonly DebugScenario[] = [
	{
		id: "incident-triage",
		primary: "INC",
		title: "Triage checkout latency regression",
		subtitle:
			"live incident follow-up with hypotheses, evidence, and next actions",
		labels: ["incident", "triage", "long-running"],
		objective:
			"Act like an on-call engineer turning noisy incident facts into a short, evidence-backed triage note.",
		steps: [
			"Summarize the alert, customer impact, and current uncertainty.",
			"Build two plausible hypotheses and identify the evidence that would confirm or rule each out.",
			"Write a handoff note with next checks, rollback criteria, and owner-facing status.",
		],
		artifacts: ["triage-note.md", "hypotheses.md"],
	},
	{
		id: "release-readiness",
		primary: "REL",
		title: "Prepare release readiness brief",
		subtitle: "release checklist, risk review, and go/no-go summary",
		labels: ["release", "readiness", "long-running"],
		objective:
			"Act like a release captain preparing a concise readiness brief from partial release facts.",
		steps: [
			"Draft a release checklist with verification, rollout, and rollback sections.",
			"Identify three realistic release risks and pair each with a mitigation.",
			"Write a go/no-go summary that names remaining unknowns without blocking on fake data.",
		],
		artifacts: ["release-brief.md", "risk-register.md"],
	},
	{
		id: "dependency-upgrade",
		primary: "DEP",
		title: "Plan dependency upgrade campaign",
		subtitle: "upgrade strategy, compatibility checks, and rollout sequencing",
		labels: ["dependencies", "planning", "long-running"],
		objective:
			"Act like a maintainer planning a safe multi-package dependency upgrade campaign.",
		steps: [
			"Inventory likely impact areas and compatibility risks.",
			"Propose an incremental upgrade sequence with validation at each step.",
			"Write a final plan with test commands, owner handoff, and rollback notes.",
		],
		artifacts: ["upgrade-plan.md", "validation-matrix.md"],
	},
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const numberField = (record: Record<string, unknown>, field: string) =>
	typeof record[field] === "number" ? record[field] : undefined;

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
		stepDelayMs: positiveInteger(
			numberField(record, "stepDelayMs"),
			DEFAULT_CONFIG.stepDelayMs,
		),
		simulateDiscoveryFailureEvery: nonNegativeInteger(
			numberField(record, "simulateDiscoveryFailureEvery"),
			DEFAULT_CONFIG.simulateDiscoveryFailureEvery,
		),
	};
	const workspaceRoot = stringField(record, "workspaceRoot");
	if (workspaceRoot !== undefined) return { ...config, workspaceRoot };
	return config;
};

const stableKey = (work: Pick<PlotExtensionWork, "id" | "version">) =>
	`${work.id}@${work.version ?? "unversioned"}`;

const safePathSegment = (value: string) =>
	value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "work";

const sleep = (ms: number, signal?: AbortSignal) =>
	new Promise<void>((resolve, reject) => {
		if (signal?.aborted) {
			reject(new Error("debug wait aborted"));
			return;
		}
		let timeout: ReturnType<typeof setTimeout>;
		const cleanup = () => {
			clearTimeout(timeout);
			signal?.removeEventListener("abort", abort);
		};
		const abort = () => {
			cleanup();
			reject(new Error("debug wait aborted"));
		};
		timeout = setTimeout(() => {
			cleanup();
			resolve();
		}, ms);
		signal?.addEventListener("abort", abort, { once: true });
	});

const scenarioContext = (input: {
	readonly scenario: DebugScenario;
	readonly cycle: number;
	readonly stepDelayMs: number;
}) =>
	JSON.stringify(
		{
			cycle: input.cycle,
			objective: input.scenario.objective,
			steps: input.scenario.steps,
			artifacts: input.scenario.artifacts,
			dashboardExpectation:
				"Three realistic long-running Work Items should run concurrently and emit progress, waits, artifacts, and completion events.",
			toolPlan: [
				"For each step: call debug_progress, call debug_wait, then continue to the next step.",
				"Write at least one requested artifact with debug_write_artifact before finishing.",
				"Finish with debug_finish only after all steps are complete.",
			],
			stepDelayMs: input.stepDelayMs,
		},
		null,
		2,
	);

export default definePlotExtension<DebugConfig>({
	id: "plot-debug-lab",
	parseConfig,
	create({ config, paths }) {
		const bootMs = Date.now();
		const tools: PlotExtensionTool<DebugConfig>[] = [];
		const completedKeys = new Set<string>();
		const log: DebugLogEntry[] = [];
		let discoverCount = 0;

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

		const addWork = (
			items: PlotExtensionWork[],
			candidate: PlotExtensionWork,
		) => {
			if (!completedKeys.has(stableKey(candidate))) items.push(candidate);
		};

		tools.push(({ work, runId }) =>
			defineTool({
				name: "debug_progress",
				label: "Debug progress",
				description:
					"Record a realistic progress checkpoint for this long-running debug Work Item.",
				promptSnippet:
					"Use debug_progress at the start of each scenario step and before final handoff.",
				parameters: {
					type: "object",
					properties: {
						step: { type: "string" },
						status: { type: "string" },
						note: { type: "string" },
					},
					required: ["step", "status", "note"],
				},
				execute: async (params) => {
					const step = typeof params.step === "string" ? params.step : "step";
					const status =
						typeof params.status === "string" ? params.status : "in_progress";
					const note =
						typeof params.note === "string" ? params.note : "progress";
					await appendLog({
						at: new Date().toISOString(),
						kind: `progress:${status}`,
						workId: work.id,
						version: work.version,
						runId,
						message: `${step}: ${note}`,
					});
					return {
						content: [
							{
								type: "text",
								text: `progress recorded for ${work.id}: ${step} (${status})`,
							},
						],
						details: { workId: work.id, version: work.version, step, status },
					};
				},
			}),
		);

		tools.push(({ work, runId }) =>
			defineTool({
				name: "debug_wait",
				label: "Debug wait",
				description:
					"Wait for a realistic amount of time so the dashboards can show a live long-running agent session.",
				parameters: {
					type: "object",
					properties: {
						milliseconds: { type: "integer" },
						reason: { type: "string" },
					},
					required: ["reason"],
				},
				execute: async (params, context) => {
					const milliseconds = positiveInteger(
						typeof params.milliseconds === "number"
							? params.milliseconds
							: undefined,
						config.stepDelayMs,
					);
					const reason =
						typeof params.reason === "string" ? params.reason : "debug wait";
					await appendLog({
						at: new Date().toISOString(),
						kind: "wait:start",
						workId: work.id,
						version: work.version,
						runId,
						message: `${milliseconds}ms: ${reason}`,
					});
					await sleep(milliseconds, context.signal);
					await appendLog({
						at: new Date().toISOString(),
						kind: "wait:done",
						workId: work.id,
						version: work.version,
						runId,
						message: reason,
					});
					return {
						content: [
							{
								type: "text",
								text: `waited ${milliseconds}ms for ${work.id}: ${reason}`,
							},
						],
					};
				},
			}),
		);

		tools.push(({ work, runId }) =>
			defineTool({
				name: "debug_write_artifact",
				label: "Debug write artifact",
				description:
					"Write a realistic markdown artifact into this Work Item workspace.",
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
							: "debug-artifact.md";
					const body = typeof params.body === "string" ? params.body : "debug";
					const targetWorkspace = work.workspace ?? workspaceFor(work.id);
					await mkdir(targetWorkspace, { recursive: true });
					const target = join(targetWorkspace, filename);
					await writeFile(target, body, "utf8");
					await appendLog({
						at: new Date().toISOString(),
						kind: "artifact:write",
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

		tools.push(({ work }) =>
			defineTool({
				name: "debug_finish",
				label: "Debug finish",
				description:
					"Finish the current realistic debug Work Item after its handoff artifact is written.",
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
						kind: "finish",
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
			tools,
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

				const cycle = Math.floor((Date.now() - bootMs) / config.cycleMs);
				const version = `cycle-${cycle}`;
				const items: PlotExtensionWork[] = [];
				for (const scenario of SCENARIOS) {
					addWork(items, {
						id: `debug:${scenario.id}`,
						version,
						title: scenario.title,
						subject: `debug:${scenario.id}`,
						workspace: workspaceFor(scenario.id),
						display: {
							kind: "debug",
							primary: scenario.primary,
							title: scenario.title,
							subtitle: scenario.subtitle,
							version,
							labels: scenario.labels,
						},
						context: {
							debugContext: scenarioContext({
								scenario,
								cycle,
								stepDelayMs: config.stepDelayMs,
							}),
						},
					});
				}
				return items;
			},
			async started(event) {
				await appendLog({
					at: new Date().toISOString(),
					kind: "hook:started",
					workId: event.work.id,
					version: event.work.version,
					runId: event.runId,
				});
			},
			async finished(event) {
				if (event.completion.status === "succeeded")
					completedKeys.add(stableKey(event.work));
				await appendLog({
					at: new Date().toISOString(),
					kind: `hook:${event.completion.status}`,
					workId: event.work.id,
					version: event.work.version,
					runId: event.runId,
					message:
						event.completion.status === "failed"
							? String(event.completion.error)
							: undefined,
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
