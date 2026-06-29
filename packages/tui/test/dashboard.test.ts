import { describe, expect, test } from "bun:test";
import { PlotDashboard } from "../src/dashboard.js";
import {
	emptyProjection,
	type DashboardProjection,
} from "@plot/session/projection";

const actions = () => {
	const opened: string[] = [];
	let quit = 0;
	let renders = 0;
	return {
		opened,
		get quitCount() {
			return quit;
		},
		get renderCount() {
			return renders;
		},
		actions: {
			tick: () => {},
			refresh: () => {},
			toggleDebug: () => {},
			quit: () => {
				quit++;
			},
			openUrl: (url: string) => opened.push(url),
			height: () => 24,
			requestRender: () => {
				renders++;
			},
		},
	};
};

const withWork = (
	patch: Partial<DashboardProjection> = {},
): DashboardProjection => ({
	...emptyProjection("default", "workflow"),
	status: "running",
	work: new Map([
		[
			"work-1",
			{
				workKey: "work-1",
				sourceId: "source",
				title: "Do thing",
				url: "https://example.com",
				labels: [],
				status: "pending",
			},
		],
	]),
	...patch,
});

describe("PlotDashboard", () => {
	test("renders active work", () => {
		const rendered = new PlotDashboard(withWork(), actions().actions)
			.render(100)
			.join("\n");
		expect(rendered).toContain("PLOT");
		expect(rendered).toContain("Do thing");
	});

	test("q exits and o opens selected work url", () => {
		const a = actions();
		const dashboard = new PlotDashboard(withWork(), a.actions);
		dashboard.handleInput("o");
		dashboard.handleInput("q");
		expect(a.opened).toEqual(["https://example.com"]);
		expect(a.quitCount).toBe(1);
	});

	test("live render clock only runs while active", async () => {
		const a = actions();
		const dashboard = new PlotDashboard(
			{
				...withWork(),
				attempts: new Map([
					[
						"run-1",
						{
							runId: "run-1",
							workKey: "work-1",
							sourceId: "source",
							stage: "working",
							startedAtSeq: 1,
							lastEventSeq: 1,
							turnCount: 0,
							eventCount: 0,
							meaningfulCount: 0,
							toolUpdateCount: 0,
							messageCount: 0,
							activity: "working",
							activityKind: "run",
							streaming: false,
							lastDisplay: "working",
							check: "not-run",
							commands: [],
							observations: [],
							streams: {},
							phases: [],
							timeline: [],
						},
					],
				]),
			},
			a.actions,
		);
		dashboard.startLiveUpdates();
		await new Promise((resolve) => setTimeout(resolve, 160));
		dashboard.stopLiveUpdates();
		const count = a.renderCount;
		await new Promise((resolve) => setTimeout(resolve, 160));
		expect(count).toBeGreaterThan(0);
		expect(a.renderCount).toBe(count);
	});
});
