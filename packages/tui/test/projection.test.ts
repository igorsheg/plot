import { describe, expect, test } from "bun:test";
import {
	plotProtocolVersion,
	type PlotServerRecord,
} from "@plot/session/protocol";
import {
	applySnapshot,
	emptyProjection,
	reduceRecord,
} from "../src/projection.js";

const eventRecord = (
	sequence: number,
	type: string,
	payload: unknown,
): PlotServerRecord => ({
	protocol: plotProtocolVersion,
	kind: "session_event",
	sessionId: "default",
	epoch: "epoch-1",
	sequence,
	event: {
		sessionId: "default",
		epoch: "epoch-1",
		sequence,
		timestamp: "2026-06-15T00:00:00.000Z",
		type,
		payload,
	},
});

const started = eventRecord(1, "attempt_started", {
	run: {
		runId: "run-1",
		workKey: "source:item:42",
		sourceId: "extension:worker",
		display: { primary: "#42", title: "Fix checkout" },
	},
});

describe("Plot TUI projection", () => {
	test("replays canonical work and attempt state", () => {
		let p = emptyProjection("default", "workflow");
		p = reduceRecord(p, started);
		expect(p.work.get("source:item:42")?.status).toBe("running");
		expect(p.attempts.has("run-1")).toBe(true);
	});

	test("completed attempts stay completed when late agent events arrive", () => {
		let p = emptyProjection("default", "workflow");
		p = reduceRecord(p, started);
		p = reduceRecord(
			p,
			eventRecord(2, "attempt_completed", {
				completion: {
					runId: "run-1",
					workKey: "source:item:42",
					status: "succeeded",
				},
			}),
		);
		p = reduceRecord(
			p,
			eventRecord(3, "agent_run_event", {
				runId: "run-1",
				event: { type: "message_delta", text: "late" },
			}),
		);
		expect(p.attempts.has("run-1")).toBe(false);
		expect(p.completed[0]?.status).toBe("succeeded");
	});

	test("snapshot repairs visible work and active attempts", () => {
		const p = applySnapshot(emptyProjection("default", "workflow"), {
			asOfSequence: 10,
			snapshot: {
				work: new Map([
					[
						"source:item:2",
						{
							workKey: "source:item:2",
							sourceId: "extension:worker",
							status: "pending",
							display: { title: "Second" },
						},
					],
				]),
				running: new Map([
					[
						"run-2",
						{
							runId: "run-2",
							workKey: "source:item:2",
							sourceId: "extension:worker",
						},
					],
				]),
			},
		});
		expect(p.frontier).toBe(10);
		expect(p.work.has("source:item:2")).toBe(true);
		expect(p.attempts.has("run-2")).toBe(true);
	});
});
