import { describe, expect, test } from "bun:test";
import { parsePlotSessions } from "../src/data/session.js";

const summary = (id: string) => ({
	id,
	workflowKey: `/${id}/WORKFLOW.md`,
	workflowName: id,
	workflowPath: `/${id}/WORKFLOW.md`,
	projectPath: `/${id}`,
	state: "online",
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:01.000Z",
	historyPath: `/${id}/.plot/sessions/${id}.jsonl`,
	lastSequence: 4,
});

describe("Web Session parser", () => {
	test("drops invalid rows but preserves future fields", () => {
		const sessions = parsePlotSessions({
			sessions: [
				{ ...summary("one"), fieldFromTheFuture: true },
				{ id: "broken" },
				summary("two"),
			],
		});

		expect(sessions.map((entry) => entry.projectPath)).toEqual([
			"/one",
			"/two",
		]);
	});
});
