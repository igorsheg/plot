import { expect, test } from "bun:test";
import {
	emptyProjection,
	serializeDashboardProjection,
} from "@plot/projection";
import { parseProjection } from "../src/data/api.js";

test("parseProjection accepts a real serialized projection envelope", () => {
	const projection = serializeDashboardProjection(
		emptyProjection("session-1", "workflow", {
			cwd: "/repo",
			cwdName: "repo",
			workflowPath: "/repo/WORKFLOW.md",
			skills: [],
			skillPaths: [],
		}),
	);
	const parsed = parseProjection({ projection });
	expect(parsed?.sessionId).toBe("session-1");
	expect(parsed?.runtime.cwdName).toBe("repo");
});
