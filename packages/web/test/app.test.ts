import { expect, test } from "bun:test";
import type { RunRecord } from "@plot/registry/record";
import {
	activeRuns,
	freshestProjection,
	pastRuns,
	projectionEventFromSse,
	projectionUrl,
	runEventsUrl,
	selectedRunFrom,
} from "../src/app/store.js";

const run = (
	id: string,
	status: RunRecord["status"],
	extra: Partial<RunRecord> = {},
): RunRecord => ({
	id,
	status,
	cwd: `/tmp/${id}`,
	createdAt: "2026-01-01T00:00:00.000Z",
	...extra,
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
	const active = activeRuns(runs);
	expect(selectedRunFrom(runs, active, "two")?.id).toBe("two");
	expect(selectedRunFrom(runs, active, "missing")?.id).toBe("one");
});

test("a stopped run stays selectable by id across all runs", () => {
	const runs = [run("live", "online"), run("gone", "stopped")];
	const active = activeRuns(runs);
	expect(selectedRunFrom(runs, active, "gone")?.id).toBe("gone");
	expect(selectedRunFrom(runs, active, undefined)?.id).toBe("live");
});

test("past runs keep stopped sessions, most-recently-seen first", () => {
	const runs = [
		run("live", "online"),
		run("old", "stopped", { lastSeenAt: "2026-01-01T00:00:00.000Z" }),
		run("recent", "stopped", { lastSeenAt: "2026-01-02T00:00:00.000Z" }),
		run("errored", "error"),
	];
	expect(pastRuns(runs).map((entry) => entry.id)).toEqual(["recent", "old"]);
});

test("projection fetch key is stable while event stream resumes after the run frontier", () => {
	const selected = { ...run("one/two", "online"), lastSequence: 7 };
	expect(projectionUrl(selected)).toBe("/api/runs/one%2Ftwo/projection");
	expect(runEventsUrl(selected)).toBe("/api/runs/one%2Ftwo/events?after=7");
});

test("SSE helper parses selected-run protocol events", () => {
	expect(
		projectionEventFromSse(
			JSON.stringify({
				kind: "event",
				event: {
					kind: "session_event",
					sessionId: "s",
					sequence: 2,
					timestamp: "2026-01-01T00:00:00.000Z",
					event: { type: "session_shutdown" },
				},
			}),
		)?.sequence,
	).toBe(2);
});

test("freshestProjection keeps the highest frontier", () => {
	const base = {
		sessionId: "s",
		workflowName: "w",
		status: "running",
		frontier: 1,
		runtime: { cwd: "/tmp", cwdName: "tmp", skills: [], skillPaths: [] },
		usageTotals: { tokens: 0 },
		tokenSamples: [],
		work: {},
		attempts: {},
		completed: [],
		diagnostics: [],
		scheduledWakes: [],
		activity: [],
		debugEvents: [],
	} as const;
	expect(freshestProjection(base, { ...base, frontier: 2 })?.frontier).toBe(2);
	expect(freshestProjection({ ...base, frontier: 3 }, base)?.frontier).toBe(3);
});
