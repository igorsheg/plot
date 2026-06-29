import { expect, test } from "bun:test";
import {
	emptyProjection,
	hydrateDashboardProjection,
	serializeDashboardProjection,
} from "../src/projection.js";

test("projection JSON helpers round-trip map fields", () => {
	const projection = emptyProjection("session-1", "workflow");
	const withMaps = {
		...projection,
		work: new Map([
			[
				"work-1",
				{
					workKey: "work-1",
					sourceId: "source-1",
					title: "Work 1",
					labels: [],
					status: "running" as const,
				},
			],
		]),
	};

	const serialized = serializeDashboardProjection(withMaps);
	expect(serialized.work["work-1"]?.title).toBe("Work 1");
	expect(hydrateDashboardProjection(serialized).work.get("work-1")?.title).toBe(
		"Work 1",
	);
});
