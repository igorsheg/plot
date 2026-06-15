import { describe, expect, test } from "bun:test";
import {
	PlotWelcomeRecord,
	decodePlotClientRecord,
	defaultPlotProtocolLimits,
	makePlotErrorResponse,
	makePlotSessionEventRecord,
	makePlotSuccessResponse,
	plotProtocolEpoch,
	plotProtocolRequestId,
	plotProtocolSequence,
	plotProtocolVersion,
} from "../src/protocol.js";
import type { SessionHistoryEvent } from "@plot/control/session-history";

const historyEvent: SessionHistoryEvent = {
	sessionId: "session-1",
	epoch: "epoch-1",
	sequence: 1,
	timestamp: "2026-06-15T00:00:00.000Z",
	type: "session_started",
	payload: {},
};

describe("plot control protocol schema", () => {
	test("decodes explicit client request envelopes", async () => {
		const request = await decodePlotClientRecord({
			protocol: plotProtocolVersion,
			kind: "request",
			id: "req-1",
			command: "request_tick",
			params: { sessionId: "session-1" },
		});

		expect(String(request.id)).toBe("req-1");
		expect(request.command).toBe("request_tick");
	});

	test("rejects old implicit commands before handling", async () => {
		let failure: { code: string } | undefined;
		try {
			await decodePlotClientRecord({
				protocol: plotProtocolVersion,
				kind: "request",
				id: "req-1",
				command: "tick_once",
			});
		} catch (error) {
			failure = error as { code: string };
		}

		expect(failure?.code).toBe("invalid_request");
	});

	test("wraps Session History events without changing payload", () => {
		const record = makePlotSessionEventRecord(historyEvent);

		expect(record).toEqual(
			expect.objectContaining({
				protocol: plotProtocolVersion,
				kind: "session_event",
				sessionId: "session-1",
				epoch: plotProtocolEpoch("epoch-1"),
				sequence: 1,
			}),
		);
		expect(record.event).toBe(historyEvent);
	});

	test("constructs welcome and response records", () => {
		const welcome = new PlotWelcomeRecord({
			connectionId: "connection-1",
			capabilities: ["stdio_jsonl"],
			limits: defaultPlotProtocolLimits,
		});
		const success = makePlotSuccessResponse({
			id: plotProtocolRequestId("req-2"),
			command: "request_tick",
			lastSequence: plotProtocolSequence(3),
			data: { accepted: true },
		});
		const failure = makePlotErrorResponse({
			id: plotProtocolRequestId("req-3"),
			command: "attach_session",
			lastSequence: plotProtocolSequence(3),
			code: "cursor_expired",
			message: "event cursor is no longer retained",
		});

		expect(welcome.kind).toBe("welcome");
		expect(success.ok).toBe(true);
		expect(success.data).toEqual({ accepted: true });
		expect(failure.ok).toBe(false);
		expect(failure.error.code).toBe("cursor_expired");
	});
});
