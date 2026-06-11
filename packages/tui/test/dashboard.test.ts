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
								lastMeaningful: "publish result",
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
					lastMeaningful: "publish result",
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
		const dashboard = new PlotDashboard(
			{ ...emptyProjection("default", "workflow"), status: "running", running },
			{ ...actions, height: () => 18 },
		);

		for (let i = 0; i < 7; i++) dashboard.handleInput("j");
		const rendered = stripAnsi(dashboard.render(100).join("\n"));

		expect(rendered).toContain("› ● #8 Item 8");
		expect(rendered).toContain("… more above");
		expect(rendered).not.toContain("#1 Item 1");
		expect(rendered.split("\n").length).toBeLessThanOrEqual(18);
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
});
