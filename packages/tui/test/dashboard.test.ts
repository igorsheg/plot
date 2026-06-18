import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { PlotDashboard } from "../src/dashboard.js";
import { emptyProjection } from "@plot/control/projection";
import type {
	AgentAttemptProjection,
	WorkItemProjection,
} from "@plot/control/projection";

const fixedNowMs = 1_700_000_000_000;

const fixture = (name: string) =>
	readFileSync(
		join(import.meta.dir, "fixtures", "dashboard", `${name}.txt`),
		"utf8",
	);

const waitFor = async (condition: () => boolean, timeoutMs = 2_000) => {
	const deadline = Date.now() + timeoutMs;
	while (!condition() && Date.now() < deadline)
		await new Promise((resolve) => setTimeout(resolve, 10));
	return condition();
};

const escape = String.fromCharCode(27);
const stripAnsi = (text: string) =>
	text.replace(new RegExp(`${escape}\\[[0-9;]*m`, "g"), "");

type RunningFixture = AgentAttemptProjection & {
	readonly primary?: string;
	readonly title: string;
	readonly subtitle?: string;
	readonly url?: string;
	readonly status?: WorkItemProjection["status"];
	readonly operatorActions?: WorkItemProjection["operatorActions"];
	readonly blockedReason?: string;
};

const runningWork = (
	overrides: Partial<RunningFixture> & { workKey: string },
): RunningFixture => ({
	runId: overrides.runId ?? `run-${overrides.workKey}`,
	sourceId: "extension:worker",
	subject: overrides.workKey,
	title: overrides.workKey,
	stage: "working",
	startedAtSeq: 1,
	lastEventSeq: 2,
	startedAtMs: Date.now() - 5_000,
	lastEventAtMs: Date.now() - 1_000,
	turnCount: 3,
	eventCount: 7,
	meaningfulCount: 4,
	toolUpdateCount: 2,
	messageCount: 1,
	activity: "working",
	activityKind: "run",
	streaming: false,
	lastMeaningful: "working",
	check: "not-run",
	commands: [],
	observations: [],
	streams: {},
	phases: [],
	timeline: [],
	...overrides,
});

const surfaces = (attemptsByWorkKey: ReadonlyMap<string, RunningFixture>) => ({
	work: new Map(
		[...attemptsByWorkKey.entries()].map(([workKey, attempt]) => [
			workKey,
			{
				workKey,
				sourceId: attempt.sourceId,
				...(attempt.subject === undefined ? {} : { subject: attempt.subject }),
				...(attempt.primary === undefined ? {} : { primary: attempt.primary }),
				title: attempt.title,
				...(attempt.subtitle === undefined
					? {}
					: { subtitle: attempt.subtitle }),
				...(attempt.url === undefined ? {} : { url: attempt.url }),
				labels: [],
				status:
					attempt.status ?? (attempt.stage === "failed" ? "failed" : "running"),
				...(attempt.operatorActions === undefined
					? {}
					: { operatorActions: attempt.operatorActions }),
				...(attempt.blockedReason === undefined
					? {}
					: { blockedReason: attempt.blockedReason }),
				currentRunId: attempt.runId,
			} satisfies WorkItemProjection,
		]),
	),
	attempts: new Map(
		[...attemptsByWorkKey.values()].map((attempt) => [attempt.runId, attempt]),
	),
});

describe("PlotDashboard", () => {
	const actions = {
		tick: () => {},
		refresh: () => {},
		toggleDebug: () => {},
		shutdown: () => {},
	};

	const withFixedNow = <T>(run: () => T): T => {
		const original = Date.now;
		Date.now = () => fixedNowMs;
		try {
			return run();
		} finally {
			Date.now = original;
		}
	};

	test("matches canonical dashboard snapshots", () =>
		withFixedNow(() => {
			const base = emptyProjection("default", "workflow", {
				cwd: "/repo/epic",
				cwdName: "epic",
				provider: "anthropic",
				model: "claude",
				skills: [],
				skillPaths: [],
				maxConcurrentRuns: 4,
			});
			const cases = {
				idle: {
					...base,
					status: "running" as const,
					pulse: {
						tickId: 42,
						atMs: fixedNowMs - 3_000,
						found: 0,
						started: 0,
					},
					scheduledWakes: [
						{ dueAtMs: fixedNowMs + 26_000, delayMs: 30_000, reason: "poll" },
					],
				},
				super_busy: {
					...base,
					status: "running" as const,
					pulse: {
						tickId: 43,
						atMs: fixedNowMs - 1_000,
						found: 5,
						started: 2,
					},
					usageTotals: { tokens: 12_000, cost: 0.0345 },
					tokenSamples: [
						{ atMs: fixedNowMs - 50_000, tokens: 1_000 },
						{ atMs: fixedNowMs - 40_000, tokens: 3_000 },
						{ atMs: fixedNowMs - 30_000, tokens: 7_000 },
						{ atMs: fixedNowMs - 20_000, tokens: 10_000 },
						{ atMs: fixedNowMs - 10_000, tokens: 12_000 },
					],
					...surfaces(
						new Map([
							[
								"a",
								runningWork({
									workKey: "a",
									primary: "#42",
									title: "Item 42",
									stage: "verifying",
									activity: "Running: bun run check",
									lastMeaningful: "Running: bun run check",
									check: "running",
									tokens: { total: 8_000 },
								}),
							],
							[
								"b",
								runningWork({
									workKey: "b",
									primary: "#43",
									title: "Item 43",
									stage: "finishing",
									activity: "Posting review",
									lastMeaningful: "Posting review",
									tokens: { total: 4_000 },
								}),
							],
						]),
					),
				},
				backoff_queue: {
					...base,
					status: "idle" as const,
					pulse: {
						tickId: 44,
						atMs: fixedNowMs - 5_000,
						found: 1,
						started: 0,
					},
					scheduledWakes: [
						{
							dueAtMs: fixedNowMs + 1_250,
							delayMs: 1_250,
							reason: "rate limit exhausted",
							workKey: "MT-450",
							attempt: 4,
						},
						{ dueAtMs: fixedNowMs + 10_000, delayMs: 10_000, reason: "poll" },
					],
					diagnostics: ["runner failed: rate limit exhausted"],
				},
			};

			for (const [name, projection] of Object.entries(cases)) {
				const rendered = new PlotDashboard(projection, actions)
					.render(120)
					.join("\n");
				expect(`${stripAnsi(rendered)}\n`).toBe(fixture(name));
			}
		}));

	test("keeps granular event churn out of fleet rows", () => {
		const dashboard = new PlotDashboard(
			{
				...emptyProjection("default", "workflow"),
				status: "running",
				...surfaces(
					new Map([
						[
							"source:item:42",
							runningWork({
								workKey: "source:item:42",
								primary: "#42",
								title: "Item 42",
								// activity is churn-resolved at reduce time; an empty live
								// line falls back to the last meaningful action.
								activity: "",
								lastMeaningful: "reviewing changed files",
							}),
						],
					]),
				),
			},
			actions,
		);

		const rendered = stripAnsi(dashboard.render(120).join("\n"));

		expect(rendered).toContain("reviewing changed files");
	});

	test("shows humanized streaming activity in fleet rows", () => {
		const dashboard = new PlotDashboard(
			{
				...emptyProjection("default", "workflow"),
				status: "running",
				...surfaces(
					new Map([
						[
							"source:item:42",
							runningWork({
								workKey: "source:item:42",
								primary: "#42",
								title: "Item 42",
								activity:
									"agent message streaming: checking the selected-row URL behavior",
								lastMeaningful: "started",
							}),
						],
					]),
				),
			},
			actions,
		);

		const rendered = stripAnsi(dashboard.render(120).join("\n"));

		expect(rendered).toContain("“checking the selected-row URL behavior”");
		expect(rendered).not.toContain("│     started");
	});

	test("renders live work rows without activity-feed noise", () => {
		const running = new Map([
			[
				"source:item:42",
				runningWork({
					workKey: "source:item:42",
					primary: "#42",
					title: "Item 42",
					stage: "verifying",
					activity: "Running: bun run check",
					lastMeaningful: "Running: bun run check",
					check: "running",
				}),
			],
			[
				"source:item:43",
				runningWork({
					workKey: "source:item:43",
					primary: "#43",
					title: "Item 43",
					stage: "finishing",
					activity: "Posting review",
					lastMeaningful: "Posting review",
				}),
			],
		]);
		const dashboard = new PlotDashboard(
			{
				...emptyProjection("default", "workflow"),
				status: "running",
				frontier: 10,
				...surfaces(running),
			},
			actions,
		);

		const rendered = dashboard.render(120).join("\n");

		expect(rendered).toContain("#42 Item 42");
		expect(rendered).toContain("#43 Item 43");
		expect(rendered).toContain("Running: bun run check");
		expect(rendered).toContain("Posting review");
		expect(rendered).not.toContain("ATTENTION");
		expect(rendered).not.toContain("DEBUG EVENTS");
	});

	test("keeps selected fleet work visible in small terminals", () => {
		const running = new Map(
			Array.from({ length: 8 }, (_, index) => {
				const id = index + 1;
				return [
					`source:item:${id}`,
					runningWork({
						workKey: `source:item:${id}`,
						primary: `#${id}`,
						title: `Item ${id}`,
						activity: `Working item ${id}`,
						lastMeaningful: `Working item ${id}`,
					}),
				] as const;
			}),
		);
		const projection = {
			...emptyProjection("default", "workflow"),
			status: "running" as const,
			...surfaces(running),
		};
		const dashboard = new PlotDashboard(projection, {
			...actions,
			height: () => 18,
		});

		for (let i = 0; i < 7; i++) dashboard.handleInput("j");
		const rendered = stripAnsi(dashboard.render(100).join("\n"));

		expect(rendered).toContain("› ● #8 Item 8");
		expect(rendered).toContain("… more above");
		expect(rendered).not.toContain("#1 Item 1");
		expect(rendered.split("\n").length).toBeLessThanOrEqual(18);

		const tinyDashboard = new PlotDashboard(projection, {
			...actions,
			height: () => 14,
		});
		for (let i = 0; i < 4; i++) tinyDashboard.handleInput("j");
		const tinyRendered = stripAnsi(tinyDashboard.render(100).join("\n"));

		expect(tinyRendered).toContain("› ● #5 Item 5");
		expect(tinyRendered.split("\n").length).toBeLessThanOrEqual(14);
	});

	test("promotes blocked work into the attention strip", () => {
		const running = new Map([
			[
				"source:item:41",
				runningWork({
					workKey: "source:item:41",
					primary: "#41",
					title: "Fix auth",
					status: "blocked",
					blockedReason: "gh auth required",
					lastMeaningful: "gh auth required",
				}),
			],
		]);
		const dashboard = new PlotDashboard(
			{
				...emptyProjection("default", "workflow"),
				status: "running",
				...surfaces(running),
			},
			actions,
		);

		const rendered = dashboard.render(120).join("\n");

		expect(rendered).toContain("Attention");
		expect(rendered).toContain("#41 Fix auth blocked");
	});

	test("renders idle as a live watching state, not emptiness", () => {
		const dashboard = new PlotDashboard(
			{
				...emptyProjection("default", "workflow"),
				status: "running",
				pulse: { tickId: 42, atMs: Date.now() - 3_000, found: 0, started: 0 },
				scheduledWakes: [{ dueAtMs: Date.now() + 26_000, delayMs: 30_000 }],
			},
			actions,
		);

		const rendered = dashboard.render(120).join("\n");

		expect(rendered).toContain("tick #42");
		expect(rendered).toContain("no active work");
		expect(rendered).toContain("next wake in");
		expect(rendered).not.toContain("none\nnone");
	});

	test("shows periodic ticks separately from retry wakes", () =>
		withFixedNow(() => {
			const dashboard = new PlotDashboard(
				{
					...emptyProjection("default", "workflow", {
						cwd: "/repo/epic",
						cwdName: "epic",
						skills: [],
						skillPaths: [],
						tickIntervalMs: 10_000,
					}),
					status: "running",
					pulse: {
						tickId: 42,
						atMs: fixedNowMs - 3_000,
						found: 0,
						started: 0,
					},
					scheduledWakes: [
						{
							dueAtMs: fixedNowMs + 26_000,
							delayMs: 30_000,
							workKey: "source:item:42",
						},
					],
				},
				actions,
			);

			const rendered = stripAnsi(dashboard.render(120).join("\n"));

			expect(rendered).toContain("next tick in 7s");
			expect(rendered).toContain("retry in 26s");
		}));

	test("toggles compact fleet help", () => {
		const dashboard = new PlotDashboard(
			emptyProjection("default", "workflow"),
			actions,
		);

		expect(stripAnsi(dashboard.render(120).join("\n"))).toContain(
			"? help · q quit",
		);
		dashboard.handleInput("?");
		expect(stripAnsi(dashboard.render(120).join("\n"))).toContain(
			"enter details",
		);
		dashboard.handleInput("?");
		expect(stripAnsi(dashboard.render(120).join("\n"))).not.toContain(
			"enter details",
		);
	});

	test("requires a second q to shut down and esc cancels", () => {
		let shutdowns = 0;
		const dashboard = new PlotDashboard(
			emptyProjection("default", "workflow"),
			{
				...actions,
				shutdown: () => {
					shutdowns++;
				},
			},
		);

		dashboard.handleInput("q");
		expect(shutdowns).toBe(0);
		expect(dashboard.render(120).join("\n")).toContain("detach this UI?");

		dashboard.handleInput("\x1b");
		dashboard.handleInput("q");
		expect(shutdowns).toBe(0);

		dashboard.handleInput("q");
		expect(shutdowns).toBe(1);
	});

	test("opens the selected work url", () => {
		const opened: string[] = [];
		const running = new Map([
			[
				"source:item:42",
				runningWork({
					workKey: "source:item:42",
					primary: "#42",
					title: "Item 42",
					url: "https://example.com/pr/42",
				}),
			],
		]);
		const dashboard = new PlotDashboard(
			{ ...emptyProjection("default", "workflow"), ...surfaces(running) },
			{
				...actions,
				openUrl: (url) => {
					opened.push(url);
				},
			},
		);

		dashboard.handleInput("o");
		expect(opened).toEqual(["https://example.com/pr/42"]);
	});

	test("shows the latest completion and opens its url", () =>
		withFixedNow(() => {
			const opened: string[] = [];
			const dashboard = new PlotDashboard(
				{
					...emptyProjection("default", "workflow"),
					completed: [
						{
							workKey: "source:item:42",
							label: "#42 Item 42",
							status: "succeeded",
							message: "review posted",
							atMs: fixedNowMs - 3_000,
							url: "https://example.com/pr/42",
						},
					],
				},
				{
					...actions,
					openUrl: (url) => {
						opened.push(url);
					},
				},
			);

			const rendered = stripAnsi(dashboard.render(120).join("\n"));
			expect(rendered).toContain("Last run");
			expect(rendered).toContain("3s ago");
			expect(rendered).toContain("✓ #42 Item 42");

			dashboard.handleInput("o");
			expect(opened).toEqual(["https://example.com/pr/42"]);
		}));

	test("does not open a completed url while work without a url is selected", () => {
		const opened: string[] = [];
		const dashboard = new PlotDashboard(
			{
				...emptyProjection("default", "workflow"),
				...surfaces(
					new Map([
						[
							"source:item:41",
							runningWork({
								workKey: "source:item:41",
								primary: "#41",
								title: "Item 41",
							}),
						],
					]),
				),
				completed: [
					{
						workKey: "source:item:42",
						label: "#42 Item 42",
						status: "succeeded",
						message: "review posted",
						atMs: fixedNowMs - 3_000,
						url: "https://example.com/pr/42",
					},
				],
			},
			{
				...actions,
				openUrl: (url) => {
					opened.push(url);
				},
			},
		);

		dashboard.handleInput("o");
		expect(opened).toEqual([]);
	});

	test("open clamps stale selection before falling back to completions", () => {
		const opened: string[] = [];
		const dashboard = new PlotDashboard(
			{
				...emptyProjection("default", "workflow"),
				...surfaces(
					new Map([
						[
							"source:item:41",
							runningWork({
								workKey: "source:item:41",
								primary: "#41",
								title: "Item 41",
								url: "https://example.com/pr/41",
							}),
						],
					]),
				),
				completed: [
					{
						workKey: "source:item:42",
						label: "#42 Item 42",
						status: "succeeded",
						message: "review posted",
						atMs: fixedNowMs - 3_000,
						url: "https://example.com/pr/42",
					},
				],
			},
			{
				...actions,
				openUrl: (url) => {
					opened.push(url);
				},
			},
		);

		dashboard.handleInput("j");
		dashboard.handleInput("o");
		expect(opened).toEqual(["https://example.com/pr/41"]);
	});

	test("debug mode exposes retained raw events", () => {
		let toggled = false;
		const dashboard = new PlotDashboard(
			{
				...emptyProjection("default", "workflow"),
				debugEvents: ["#2 agent_session_event", "#1 attempt_started"],
			},
			{
				...actions,
				toggleDebug: () => {
					toggled = true;
				},
			},
		);

		dashboard.handleInput("d");
		const rendered = dashboard.render(100).join("\n");

		expect(toggled).toBe(true);
		expect(rendered).toContain("DEBUG EVENTS");
		expect(rendered).toContain("#2 agent_session_event");
	});

	describe("live render clock", () => {
		const runningProjection = () => ({
			...emptyProjection("default", "workflow"),
			...surfaces(new Map([["work-1", runningWork({ workKey: "work-1" })]])),
		});

		test("visible running work drives render requests between start and stop", async () => {
			let renders = 0;
			const dashboard = new PlotDashboard(runningProjection(), {
				...actions,
				requestRender: () => {
					renders += 1;
				},
			});
			dashboard.startLiveUpdates();
			try {
				expect(await waitFor(() => renders > 0)).toBe(true);
			} finally {
				dashboard.stopLiveUpdates();
			}
		});

		test("projection updates cannot restart the clock after stopLiveUpdates", async () => {
			let renders = 0;
			const dashboard = new PlotDashboard(runningProjection(), {
				...actions,
				requestRender: () => {
					renders += 1;
				},
			});
			dashboard.startLiveUpdates();
			await waitFor(() => renders > 0);
			dashboard.stopLiveUpdates();
			// A late async projection update arriving mid-shutdown.
			dashboard.setProjection(runningProjection());
			const after = renders;
			await new Promise((resolve) => setTimeout(resolve, 300));
			expect(renders).toBe(after);
		});

		test("an idle projection retunes the clock off while live", async () => {
			let renders = 0;
			const dashboard = new PlotDashboard(runningProjection(), {
				...actions,
				requestRender: () => {
					renders += 1;
				},
			});
			dashboard.startLiveUpdates();
			try {
				await waitFor(() => renders > 0);
				dashboard.setProjection(emptyProjection("default", "workflow"));
				const after = renders;
				await new Promise((resolve) => setTimeout(resolve, 300));
				expect(renders).toBe(after);
			} finally {
				dashboard.stopLiveUpdates();
			}
		});
	});
});
