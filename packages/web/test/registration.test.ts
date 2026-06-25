import { describe, expect, test } from "bun:test";
import { parsePlotSessionRegistrations } from "../src/registration.js";

describe("web registration parser", () => {
	test("drops invalid rows but keeps distinct project sessions", () => {
		const sessions = parsePlotSessionRegistrations({
			sessions: [
				{
					version: 1,
					key: "one",
					sessionId: "default",
					workflowName: "one",
					workflowPath: "/one/WORKFLOW.md",
					cwd: "/one",
					cwdName: "one",
					sessionDir: "/one/.plot/sessions/default",
					eventLogPath: "/one/.plot/sessions/default/events.jsonl",
					pid: 1,
					startedAt: "2026-01-01T00:00:00.000Z",
					heartbeatAt: "2026-01-01T00:00:01.000Z",
					lastSequence: 4,
				},
				{ sessionId: "broken" },
				{
					version: 1,
					key: "two",
					sessionId: "default",
					workflowName: "two",
					workflowPath: "/two/WORKFLOW.md",
					cwd: "/two",
					cwdName: "two",
					sessionDir: "/two/.plot/sessions/default",
					eventLogPath: "/two/.plot/sessions/default/events.jsonl",
					pid: 2,
					startedAt: "2026-01-02T00:00:00.000Z",
					heartbeatAt: "2026-01-02T00:00:01.000Z",
					lastSequence: 7,
				},
			],
		});

		expect(sessions.map((entry) => entry.cwd)).toEqual(["/one", "/two"]);
	});
});
