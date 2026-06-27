import { describe, expect, test } from "bun:test";
import { parsePlotInstances } from "../src/instance.js";

describe("web instance parser", () => {
	test("drops invalid rows but keeps supervised sessions", () => {
		const sessions = parsePlotInstances({
			instances: [
				{
					id: "one",
					status: "online",
					sessionId: "default",
					workflowName: "one",
					workflowPath: "/one/WORKFLOW.md",
					cwd: "/one",
					cwdName: "one",
					createdAt: "2026-01-01T00:00:00.000Z",
					lastSeenAt: "2026-01-01T00:00:01.000Z",
					lastSequence: 4,
				},
				{ sessionId: "broken" },
				{
					id: "two",
					status: "online",
					sessionId: "default",
					workflowName: "two",
					workflowPath: "/two/WORKFLOW.md",
					cwd: "/two",
					cwdName: "two",
					createdAt: "2026-01-02T00:00:00.000Z",
					lastSeenAt: "2026-01-02T00:00:01.000Z",
					lastSequence: 7,
				},
			],
		});

		expect(sessions.map((entry) => entry.cwd)).toEqual(["/one", "/two"]);
	});
});
