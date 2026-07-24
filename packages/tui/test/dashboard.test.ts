import { describe, expect, test } from "bun:test";
import { Dashboard } from "../src/dashboard.js";
import { emptyProjection, type DashboardProjection } from "@plot/projection";

const actions = () => {
	const opened: string[] = [];
	let stops = 0;
	let detaches = 0;
	let renders = 0;
	return {
		opened,
		get stopCount() {
			return stops;
		},
		get detachCount() {
			return detaches;
		},
		get renderCount() {
			return renders;
		},
		actions: {
			tick: () => {},
			refresh: () => {},
			toggleDebug: () => {},
			stop: () => {
				stops++;
			},
			detach: () => {
				detaches++;
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

describe("Dashboard", () => {
	test("renders active work", () => {
		const rendered = new Dashboard(withWork(), actions().actions)
			.render(100)
			.join("\n");
		expect(rendered).toContain("PLOT");
		expect(rendered).toContain("Do thing");
	});

	test("groups related Work Items under their Subject", () => {
		const subjectKey = JSON.stringify(["source", "github:acme/web:pr:42"]);
		const projection = withWork({
			work: new Map([
				[
					"unit-1",
					{
						workKey: "unit-1",
						sourceId: "source",
						subject: "github:acme/web:pr:42",
						subjectKey,
						title: "checkout.ts",
						labels: [],
						status: "running",
					},
				],
				[
					"unit-2",
					{
						workKey: "unit-2",
						sourceId: "source",
						subject: "github:acme/web:pr:42",
						subjectKey,
						title: "pricing.ts",
						labels: [],
						status: "pending",
					},
				],
			]),
			subjects: new Map([
				[
					subjectKey,
					{
						subjectKey,
						sourceId: "source",
						id: "github:acme/web:pr:42",
						display: {
							primary: "#42",
							title: "Repair checkout",
							subtitle: "acme/web",
						},
						progress: { completed: 2, total: 4, phase: "reviewing" },
						workKeys: ["unit-1", "unit-2"],
					},
				],
			]),
		});

		const rendered = new Dashboard(projection, actions().actions)
			.render(100)
			.join("\n")
			.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"), "");

		expect(rendered).toContain("#42 Repair checkout");
		expect(rendered).toContain("acme/web · 2/4 complete · reviewing");
		expect(rendered).toContain("├─ ● checkout.ts");
		expect(rendered).toContain("└─ ◌ pricing.ts");
	});

	test("renders Source setup before any work exists", () => {
		const projection: DashboardProjection = {
			...emptyProjection("default", "workflow"),
			status: "idle",
			sources: new Map([
				[
					"extension:jira",
					{
						sourceId: "extension:jira",
						label: "Wix Jira",
						readiness: "action-required",
						diagnostics: [],
						requirements: [
							{
								id: "wix-mcp",
								label: "Wix MCP",
								status: "action-required",
								message: "Connect Wix MCP to discover Jira issues",
								actions: [{ id: "connect", label: "Connect Wix MCP" }],
							},
						],
					},
				],
			]),
		};
		const rendered = new Dashboard(projection, actions().actions)
			.render(100)
			.join("\n");

		expect(rendered).toContain("Sources");
		expect(rendered).toContain("Wix Jira");
		expect(rendered).toContain("Connect Wix MCP to discover Jira issues");
	});

	test("invokes an available Source setup action", () => {
		const started: unknown[] = [];
		const state = actions();
		const projection: DashboardProjection = {
			...emptyProjection("default", "workflow"),
			sources: new Map([
				[
					"extension:jira",
					{
						sourceId: "extension:jira",
						label: "Jira",
						readiness: "action-required",
						diagnostics: [],
						requirements: [
							{
								id: "auth",
								label: "Auth",
								status: "action-required",
								actions: [{ id: "connect", label: "Connect" }],
							},
						],
					},
				],
			]),
		};
		const dashboard = new Dashboard(projection, {
			...state.actions,
			sourceAction: (input) => started.push(input),
		});

		dashboard.handleInput("s");

		expect(started).toEqual([
			{
				sourceId: "extension:jira",
				requirementId: "auth",
				actionId: "connect",
			},
		]);
	});

	test("renders streaming status as one terminal row", () => {
		const rendered = new Dashboard(
			withWork({
				work: new Map([
					[
						"work-1",
						{
							workKey: "work-1",
							sourceId: "source",
							title: "Do thing",
							labels: [],
							status: "running",
							currentRunId: "run-1",
						},
					],
				]),
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
							activityKind: "message",
							streaming: true,
							lastDisplay: "working",
							check: "not-run",
							commands: [],
							observations: [],
							streams: {
								message: "agent message streaming: hello\n\tworld\ragain",
							},
							phases: [],
							timeline: [],
						},
					],
				]),
			}),
			actions().actions,
		).render(100);

		expect(rendered.some((line) => /[\r\n]/.test(line))).toBe(false);
		expect(
			rendered
				.join("\n")
				.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"), ""),
		).toContain("hello world again");
	});

	test("q confirms before stopping while d explicitly detaches", () => {
		const a = actions();
		const dashboard = new Dashboard(withWork(), a.actions);
		dashboard.handleInput("o");
		dashboard.handleInput("q");

		expect(a.opened).toEqual(["https://example.com"]);
		expect(a.stopCount).toBe(0);
		expect(dashboard.render(100).join("\n")).toContain("Stop workflow?");

		dashboard.handleInput("q");
		expect(a.stopCount).toBe(1);

		const detached = actions();
		new Dashboard(withWork(), detached.actions).handleInput("d");
		expect(detached.detachCount).toBe(1);
	});

	test("escape cancels stop confirmation", () => {
		const a = actions();
		const dashboard = new Dashboard(withWork(), a.actions);
		dashboard.handleInput("q");
		dashboard.handleInput("\u001b");
		dashboard.handleInput("q");

		expect(a.stopCount).toBe(0);
		expect(dashboard.render(100).join("\n")).toContain("Stop workflow?");
	});

	test("live render clock only runs while active", async () => {
		const a = actions();
		const dashboard = new Dashboard(
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
