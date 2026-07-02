import { expect, test } from "bun:test";
import {
	emptyProjection,
	serializeDashboardProjection,
} from "@plot/session/projection";
import { renderToString } from "react-dom/server";
import type { WebDashboardProjection } from "../src/api.js";
import { Inspector } from "../src/inspector.js";

const projection = (): WebDashboardProjection => ({
	...serializeDashboardProjection(emptyProjection("session-1", "workflow")),
	work: {
		"work-1": {
			workKey: "work-1",
			sourceId: "source-1",
			title: "Review PR #7",
			labels: ["pr"],
			status: "blocked",
			blockedReason: "needs approval",
			operatorActions: [{ id: "approve", label: "Approve" }],
			currentRunId: "run-1",
			url: "https://example.com/pr/7",
		},
	},
	attempts: {
		"run-1": {
			runId: "run-1",
			workKey: "work-1",
			sourceId: "source-1",
			stage: "working",
			startedAtSeq: 1,
			lastEventSeq: 5,
			startedAtMs: 1000,
			lastEventAtMs: 61_000,
			turnCount: 2,
			eventCount: 5,
			meaningfulCount: 3,
			toolUpdateCount: 1,
			messageCount: 1,
			activity: "editing board.tsx",
			activityKind: "edit",
			streaming: true,
			lastDisplay: "editing board.tsx",
			check: "running",
			commands: [],
			observations: [],
			streams: { thinking: "planning the change" },
			phases: [],
			timeline: [{ atMs: 2000, text: "read board.tsx", kind: "read" }],
			transcript: { path: "/tmp/transcript.jsonl" },
		},
	},
	completed: [
		{
			workKey: "work-1",
			label: "Review PR #7",
			status: "failed",
			message: "checks failed",
			atMs: 500,
		},
	],
});

test("inspector renders operator zone, live run, timeline, and history", () => {
	const html = renderToString(
		<Inspector
			onAction={async () => true}
			onClose={() => undefined}
			projection={projection()}
			workKey="work-1"
		/>,
	);
	expect(html).toContain("needs approval");
	expect(html).toContain("Approve");
	expect(html).toContain("planning the change");
	expect(html).toContain("read board.tsx");
	expect(html).toContain("checks failed");
	expect(html).toContain("/tmp/transcript.jsonl");
});

test("inspector renders nothing for an unknown work key", () => {
	const html = renderToString(
		<Inspector
			onAction={async () => true}
			onClose={() => undefined}
			projection={serializeDashboardProjection(emptyProjection("s", "w"))}
			workKey="missing"
		/>,
	);
	expect(html).toBe("");
});
