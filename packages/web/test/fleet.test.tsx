import { expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { FleetBriefHome } from "../src/fleet.js";
import type { FleetStream } from "../src/derive-fleet.js";

const stream = (input: Partial<FleetStream>): FleetStream => ({
	key: "workflow\0/repo",
	name: "Workflow",
	cwd: "/repo",
	cwdName: "repo",
	runs: [],
	currentRun: {
		id: "run-1",
		status: "stopped",
		cwd: "/repo",
		createdAt: "2026-01-01T00:00:00.000Z",
		workflowName: "Workflow",
	},
	needsYou: 0,
	acting: 0,
	state: "ended",
	verb: "ended 1h ago",
	lastSeenMs: Date.now() - 3_600_000,
	...input,
});

test("fleet brief says nothing is running when no stream is live", () => {
	const html = renderToString(
		<FleetBriefHome
			onSelect={() => undefined}
			projections={new Map()}
			streams={[stream({})]}
		/>,
	);

	expect(html).toContain("Nothing is running.");
	expect(html).not.toContain("All quiet across the fleet.");
});

test("fleet brief ended rows keep ago only in the mono cell", () => {
	const html = renderToString(
		<FleetBriefHome
			onSelect={() => undefined}
			projections={new Map()}
			streams={[stream({})]}
		/>,
	);

	expect(html).toContain(">ended<");
	expect(html).not.toContain("ended 1h ago");
	expect(html).toContain("whitespace-nowrap");
});
