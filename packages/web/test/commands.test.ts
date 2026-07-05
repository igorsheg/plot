import { describe, expect, test } from "bun:test";
import {
	emptyProjection,
	serializeDashboardProjection,
	type WorkItemProjection,
} from "@plot/session/projection";
import type { WebDashboardProjection } from "../src/api.js";
import { buildCommands, filterCommands, fuzzyMatch } from "../src/commands.js";
import type { FleetStream } from "../src/derive-fleet.js";

const stream: FleetStream = {
	key: "workflow\0/repo",
	name: "Workflow",
	cwd: "/repo",
	cwdName: "repo",
	runs: [],
	currentRun: {
		id: "run-1",
		status: "running",
		cwd: "/repo",
		createdAt: "2026-01-01T00:00:00.000Z",
		workflowName: "Workflow",
	},
	needsYou: 1,
	acting: 0,
	state: "watching",
	verb: "watching",
	lastSeenMs: 1000,
};

const work = (
	workKey: string,
	input: Partial<WorkItemProjection> = {},
): WorkItemProjection => ({
	workKey,
	sourceId: "source-1",
	title: workKey,
	labels: [],
	status: "blocked",
	...input,
});

const projection = (
	items: readonly WorkItemProjection[],
): WebDashboardProjection => ({
	...serializeDashboardProjection(emptyProjection("session-1", "workflow")),
	work: Object.fromEntries(items.map((item) => [item.workKey, item])),
});

describe("fuzzyMatch", () => {
	test("matches case-insensitive subsequences", () => {
		expect(fuzzyMatch("owf", "open Workflow")).toBe(true);
		expect(fuzzyMatch("OWF", "open Workflow")).toBe(true);
		expect(fuzzyMatch("wfz", "open Workflow")).toBe(false);
	});
});

describe("buildCommands", () => {
	test("groups streams, work, actions, time, and system commands", () => {
		const commands = buildCommands({
			anchorMs: 5000,
			nowMs: 10_000,
			projection: projection([
				work("review", {
					title: "Review PR",
					operatorActions: [
						{ id: "approve", label: "Approve" },
						{ id: "delete", label: "Delete", confirm: { title: "Delete" } },
						{ id: "disabled", label: "Disabled", disabledReason: "no" },
					],
				}),
			]),
			streams: [stream],
		});

		expect(
			commands.map((command) => `${command.group}:${command.label}`),
		).toEqual([
			"Streams:open Workflow",
			"Work:inspect Review PR",
			"Actions:Approve — Review PR",
			"Time:jump to since you left",
			"Time:jump to 1 hour ago",
			"Time:jump to last night (6h)",
			"Time:return to now",
			"System:toggle theme",
		]);
	});

	test("omits since-you-left without an anchor and filters commands", () => {
		const commands = buildCommands({
			nowMs: 10_000,
			projection: projection([]),
			streams: [stream],
		});

		expect(
			commands.some((command) => command.label === "jump to since you left"),
		).toBe(false);
		expect(
			filterCommands(commands, "togg").map((command) => command.label),
		).toEqual(["toggle theme"]);
	});
});
