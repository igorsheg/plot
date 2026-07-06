import { expect, test } from "bun:test";
import {
	activeRuns,
	projectionUrl,
	selectedRunFrom,
	sessionBrief,
	statusTone,
} from "../src/app/store.js";
import type { WebDashboardProjection } from "../src/data/api.js";
import type { PlotRun } from "../src/data/run.js";

const run = (id: string, status: PlotRun["status"]): PlotRun => ({
	id,
	status,
	cwd: `/tmp/${id}`,
	createdAt: "2026-01-01T00:00:00.000Z",
});

test("session dock keeps only active runs", () => {
	expect(
		activeRuns([
			run("one", "online"),
			run("two", "stopped"),
			run("three", "error"),
		]).map((entry) => entry.id),
	).toEqual(["one"]);
});

test("selected run falls back to the first active session", () => {
	const runs = [run("one", "online"), run("two", "online")];
	expect(selectedRunFrom(runs, "two")?.id).toBe("two");
	expect(selectedRunFrom(runs, "missing")?.id).toBe("one");
});

test("projection query key tracks run sequence without changing the route", () => {
	expect(projectionUrl({ ...run("one/two", "online"), lastSequence: 7 })).toBe(
		"/api/runs/one%2Ftwo/projection?seq=7",
	);
});

test("status tone makes blocked work loud", () => {
	expect(statusTone("blocked")).toBe("error");
	expect(statusTone("waiting")).toBe("warning");
});

test("operator brief separates current work from decisions", () => {
	const projection = {
		sessionId: "session-1",
		workflowName: "Web rebuild",
		status: "running",
		frontier: 12,
		runtime: { cwd: "/repo", cwdName: "repo", skills: [], skillPaths: [] },
		usageTotals: { tokens: 123 },
		tokenSamples: [],
		work: {
			blocked: {
				workKey: "blocked",
				sourceId: "source",
				title: "Pick product direction",
				labels: [],
				status: "blocked",
				blockedReason: "Need operator decision",
			},
			running: {
				workKey: "running",
				sourceId: "source",
				title: "Build main screen",
				labels: [],
				status: "running",
				currentRunId: "attempt-1",
			},
		},
		attempts: {
			"attempt-1": {
				runId: "attempt-1",
				workKey: "running",
				sourceId: "source",
				stage: "working",
				startedAtSeq: 1,
				lastEventSeq: 12,
				turnCount: 2,
				eventCount: 10,
				meaningfulCount: 4,
				toolUpdateCount: 2,
				messageCount: 1,
				activity: "Editing session-document.tsx",
				activityKind: "edit",
				streaming: false,
				lastDisplay: "Editing session-document.tsx",
				check: "not-run",
				commands: [],
				observations: [],
				streams: {},
				phases: [],
				timeline: [],
			},
		},
		completed: [
			{
				workKey: "done",
				label: "Installed Phosphor icons",
				status: "done",
				message: "Icon set is definitive",
				atMs: 1,
			},
		],
		diagnostics: ["daemon restarted"],
		scheduledWakes: [],
		activity: [],
		debugEvents: [],
	} satisfies WebDashboardProjection;

	const brief = sessionBrief(projection);
	expect(brief.now.map((item) => item.label)).toEqual(["Build main screen"]);
	expect(brief.attention.map((item) => item.activity)).toEqual([
		"Need operator decision",
	]);
	expect(brief.diagnostics).toEqual(["daemon restarted"]);
	expect(brief.recent.map((item) => item.label)).toEqual([
		"Installed Phosphor icons",
	]);
});
