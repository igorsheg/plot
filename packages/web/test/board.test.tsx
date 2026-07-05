import { expect, test } from "bun:test";
import {
	emptyProjection,
	serializeDashboardProjection,
} from "@plot/session/projection";
import { renderToString } from "react-dom/server";
import { LivenessBanner, NoLiveBoard, type BoardState } from "../src/board.js";
import type { PlotRun } from "../src/run.js";

const crashed: PlotRun = {
	id: "run-1",
	status: "error",
	cwd: "/repo",
	createdAt: "2026-01-01T00:00:00.000Z",
	workflowName: "workflow",
	stderrTail: "TypeError: boom at agent.ts:1",
};

const state: BoardState = {
	loading: false,
	projection: serializeDashboardProjection(
		emptyProjection("session-1", "workflow"),
	),
};

test("the console shell surfaces a crashed session's stderr tail", () => {
	const html = renderToString(<LivenessBanner run={crashed} state={state} />);
	expect(html).toContain("This session crashed");
	expect(html).toContain("TypeError: boom at agent.ts:1");
});

test("a cleanly stopped session shows no diagnostics block", () => {
	const html = renderToString(
		<NoLiveBoard error="x" run={{ ...crashed, status: "stopped" }} />,
	);
	expect(html).toContain("No live board");
	expect(html).not.toContain("TypeError");
});
