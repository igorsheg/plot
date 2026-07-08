import { describe, expect, test } from "bun:test";
import { formatRunResponse, formatRunsTable } from "../src/run-output.js";

const record = {
	id: "76e84f20-ca5e-4061-8e66-d8dab84950d4",
	status: "online",
	cwd: "/repo/epic",
	cwdName: "epic",
	createdAt: "2026-01-01T00:00:00.000Z",
	lastSeenAt: "2026-01-01T00:00:50.000Z",
	workflowName: "pr-review",
	lastSequence: 42,
} as const;

const nowMs = Date.parse("2026-01-01T00:01:00.000Z");

describe("run output", () => {
	test("ls renders a table with live runs first", () => {
		const stopped = {
			...record,
			id: "aaaaaaaa-0000-0000-0000-000000000000",
			status: "stopped",
		} as const;
		const text = formatRunsTable([stopped, record], nowMs);
		expect(text).toContain("ID");
		expect(text.indexOf("76e84f20")).toBeLessThan(text.indexOf("aaaaaaaa"));
		expect(text).toContain("pr-review");
		expect(text).toContain("10s");
		expect(formatRunsTable([], nowMs)).toBe("No Plot runs.");
	});

	test("status, stop, prune and error render for humans", () => {
		expect(
			formatRunResponse(
				{ type: "status_result", ok: true, run: record },
				nowMs,
			),
		).toContain("status   online");
		expect(formatRunResponse({ type: "status_result", ok: true }, nowMs)).toBe(
			"Run not found.",
		);
		expect(
			formatRunResponse(
				{ type: "stop_result", ok: true, id: record.id, run: record },
				nowMs,
			),
		).toContain("Stopped 76e84f20");
		expect(
			formatRunResponse({ type: "prune_result", ok: true, removed: [] }, nowMs),
		).toBe("Nothing to clean.");
		expect(
			formatRunResponse({ type: "error", ok: false, error: "boom" }, nowMs),
		).toBe("Error: boom");
	});
});
