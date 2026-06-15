import { describe, expect, test } from "bun:test";
import { plotControlPackageName } from "@plot/control";
import { emptyProjection } from "@plot/control/projection";
import { safeParsePlotSessionSummary } from "@plot/control/session-summary";

describe("web control package boundary", () => {
	test("can consume browser-safe control schemas and projection helpers", () => {
		const projection = emptyProjection("session-1", "workflow");
		const summary = safeParsePlotSessionSummary({
			id: "session-1",
			epoch: "epoch-1",
			mode: "watch",
			state: "watching",
			workflowName: "workflow",
			workflowPath: "WORKFLOW.md",
			cwd: "/repo",
			cwdName: "repo",
			agents: { active: 0, max: 4 },
			needsYouCount: 0,
			tokenThroughputPerSecond: null,
			totalTokens: 0,
			lastActivityAt: null,
			attachments: { observers: 1, controllers: 0 },
		});

		expect(plotControlPackageName).toBe("@plot/control");
		expect(projection.sessionId).toBe("session-1");
		expect(summary.success).toBe(true);
	});
});
