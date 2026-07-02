import { expect, test } from "bun:test";
import type { WorkItemProjection } from "@plot/session/projection";
import type { WorkRowModel } from "../src/dashboard-model.js";
import { detailBodyLines } from "../src/detail-view.js";

const work: WorkItemProjection = {
	workKey: "work-1",
	sourceId: "source-1",
	title: "Work 1",
	labels: [],
	status: "blocked",
	blockedReason: "needs approval",
	operatorActions: [
		{ id: "approve", label: "Approve" },
		{ id: "skip" },
		"garbage",
	],
};

const row: WorkRowModel = {
	work,
	label: "Work 1",
	status: "blocked",
	meta: "",
	activity: "waiting",
	lastEventAgo: "1s",
	stale: false,
	attention: true,
};

test("attention section lists Source-declared operator actions", () => {
	const text = detailBodyLines(row, 2000)
		.map((line) => JSON.stringify(line))
		.join("\n");
	expect(text).toContain("needs approval");
	expect(text).toContain("actions: Approve · skip");
});
