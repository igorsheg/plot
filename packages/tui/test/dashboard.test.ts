import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { PlotDashboard } from "../src/dashboard.js";
import { emptyProjection } from "../src/projection.js";
import type { RunningWorkProjection } from "../src/projection.js";

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

const runningWork = (
	overrides: Partial<RunningWorkProjection> & { workKey: string },
): RunningWorkProjection => ({
	runId: "run-1",
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
	toolUpdateCount: 2,
	messageCount: 1,
	seenTurnIds: ["1", "2", "3"],
	lastMessage: "working",
	activity: "working",
	lastMeaningful: "working",
	check: "not-run",
	commands: [],
	observations: [],
	timeline: [],
	...overrides,
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
					running: new Map([
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
				running: new Map([
					[
						"source:item:42",
						runningWork({
							workKey: "source:item:42",
							primary: "#42",
							title: "Item 42",
							activity: "code_quality: message_update",
							lastMeaningful: "reviewing changed files",
						}),
					],
				]),
			},
			actions,
		);

		const rendered = stripAnsi(dashboard.render(120).join("\n"));

		expect(rendered).toContain("reviewing changed files");
		expect(rendered).not.toContain("message_update");
	});

	test("shows humanized streaming activity in fleet rows", () => {
		const dashboard = new PlotDashboard(
			{
				...emptyProjection("default", "workflow"),
				status: "running",
				running: new Map([
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
			},
			actions,
		);

		const rendered = stripAnsi(dashboard.render(120).join("\n"));

		expect(rendered).toContain("“checking the selected-row URL behavior”");
		expect(rendered).not.toContain("│     started");
	});

	test("renders a two-line board row per running work", () => {
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
				running,
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
			running,
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
					stage: "blocked",
					lastMeaningful: "gh auth required",
				}),
			],
		]);
		const dashboard = new PlotDashboard(
			{ ...emptyProjection("default", "workflow"), status: "running", running },
			actions,
		);

		const rendered = dashboard.render(120).join("\n");

		expect(rendered).toContain("ATTENTION");
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
		expect(rendered).toContain("no active work — watching");
		expect(rendered).toContain("next tick in");
		expect(rendered).not.toContain("none\nnone");
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
		expect(dashboard.render(120).join("\n")).toContain("shut down the fleet?");

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
			{ ...emptyProjection("default", "workflow"), running },
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

	test("shows recent completions and opens the latest completed url", () =>
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
			expect(rendered).toContain("Completed");
			expect(rendered).toContain("3s ago");
			expect(rendered).toContain("#42 Item 42 succeeded · review posted");

			dashboard.handleInput("o");
			expect(opened).toEqual(["https://example.com/pr/42"]);
		}));

	test("debug mode exposes retained raw events", () => {
		let toggled = false;
		const dashboard = new PlotDashboard(
			{
				...emptyProjection("default", "workflow"),
				debugEvents: ["#2 agent_session_event", "#1 work_started"],
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
			running: new Map([["work-1", runningWork({ workKey: "work-1" })]]),
		});

		test("running work drives render requests between start and stop", async () => {
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
