import { expect, test } from "bun:test";
import type {
	AgentAttemptProjection,
	WorkItemProjection,
} from "@plot/session/projection";
import type { WorkRowModel } from "../src/dashboard-model.js";
import { detailBodyLines } from "../src/detail-view.js";

const work: WorkItemProjection = {
	workKey: "work-1",
	sourceId: "source-1",
	title: "Work 1",
	labels: [],
	status: "running",
};

const attempt = (timelineLength: number): AgentAttemptProjection => ({
	runId: "run-1",
	workKey: "work-1",
	sourceId: "source-1",
	stage: "working",
	startedAtSeq: 1,
	lastEventSeq: timelineLength,
	turnCount: 1,
	eventCount: timelineLength,
	meaningfulCount: timelineLength,
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
	timeline: Array.from({ length: timelineLength }, (_, index) => ({
		atMs: 1000 + index,
		text: `step-${index + 1}`,
		kind: "run" as const,
	})),
});

const row = (timelineLength: number): WorkRowModel => ({
	work,
	attempt: attempt(timelineLength),
	label: "Work 1",
	status: "running",
	meta: "",
	activity: "working",
	lastEventAgo: "1s",
	stale: false,
	attention: false,
});

test("work trail shows the newest timeline entries in chronological order", () => {
	const text = detailBodyLines(row(20), 2000)
		.map((line) => JSON.stringify(line))
		.join("\n");
	// The newest entry is present; the oldest has scrolled out of the window.
	expect(text).toContain("step-20");
	expect(text).not.toContain("step-1\u0022");
	expect(text.indexOf("step-19")).toBeLessThan(text.indexOf("step-20"));
});
