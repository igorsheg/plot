import { describe, expect, test } from "bun:test";
import { PlotDashboard } from "../src/dashboard.js";
import { emptyProjection } from "../src/projection.js";

describe("PlotDashboard", () => {
	const actions = {
		tick: () => {},
		refresh: () => {},
		toggleDebug: () => {},
		shutdown: () => {},
	};

	test("renders one fleet row per running work without raw event spam", () => {
		const running = new Map([
			[
				"source:item:42",
				{
					workKey: "source:item:42",
					runId: "run-1",
					sourceId: "extension:worker",
					subject: "source:item:42",
					primary: "#42",
					title: "Item 42",
					stage: "testing" as const,
					startedAtSeq: 1,
					lastEventSeq: 2,
					turnCount: 3,
					lastMessage: "bun run check",
					check: "running" as const,
					commands: ["bun run check"],
					observations: [],
					timeline: ["#2 bun run check"],
				},
			],
			[
				"source:item:43",
				{
					workKey: "source:item:43",
					runId: "run-2",
					sourceId: "extension:worker",
					subject: "source:item:43",
					primary: "#43",
					title: "Item 43",
					stage: "publishing" as const,
					startedAtSeq: 2,
					lastEventSeq: 3,
					turnCount: 4,
					lastMessage: "publish result",
					check: "passed" as const,
					commands: ["publish result"],
					observations: [],
					timeline: ["#3 publish result"],
				},
			],
		]);
		const dashboard = new PlotDashboard(
			{
				...emptyProjection("default", "workflow"),
				status: "running",
				frontier: 10,
				running,
				timeline: ["#9 agent_session_event", "#8 agent_session_event"],
			},
			actions,
		);

		const rendered = dashboard.render(120).join("\n");

		expect(rendered).toContain("#42 Item 42");
		expect(rendered).toContain("#43 Item 43");
		expect(rendered).toContain("bun run check");
		expect(rendered).toContain("publish result");
		expect(rendered).not.toContain("DEBUG EVENTS");
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
