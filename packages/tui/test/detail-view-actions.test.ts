import { expect, test } from "bun:test";
import type { WorkItemProjection } from "@plot/projection";
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
		{ id: "skip", label: "Skip" },
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
	expect(text).toContain("actions: Approve · Skip");
});

test("waiting work does not render as attention", () => {
	const text = detailBodyLines(
		{
			...row,
			work: {
				...work,
				status: "waiting",
				blockedReason: "reviewed at this head",
				operatorActions: [{ id: "review-again", label: "Review again" }],
			},
			status: "waiting",
			activity: "idle",
			attention: false,
		},
		2000,
	)
		.map((line) => JSON.stringify(line))
		.join("\n");
	expect(text).not.toContain("Attention");
	expect(text).not.toContain("reviewed at this head");
	expect(text).not.toContain("Review again");
});
