import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { tickId } from "@plot/agent/model";
import {
	SessionStartedEvent,
	plotSessionEventSequence,
	plotSessionId,
} from "../src/plot-session.js";
import {
	PlotHelloRecord,
	decodePlotClientRecord,
	defaultPlotProtocolLimits,
	makePlotErrorResponse,
	makePlotEventRecord,
	makePlotSuccessResponse,
	plotProtocolEpoch,
	plotProtocolRequestId,
	plotProtocolSequence,
} from "../src/protocol.js";

const sessionId = plotSessionId("default");
const epoch = plotProtocolEpoch("epoch-1");

describe("plot protocol schema", () => {
	test("decodes client request envelopes", async () => {
		const request = await Effect.runPromise(
			decodePlotClientRecord({
				protocol: "plot.v1",
				kind: "request",
				id: "req-1",
				command: "tick_once",
			}),
		);

		expect(String(request.id)).toBe("req-1");
		expect(request.command).toBe("tick_once");
	});

	test("rejects unknown commands before handling", async () => {
		const failure = await Effect.runPromise(
			Effect.flip(
				decodePlotClientRecord({
					protocol: "plot.v1",
					kind: "request",
					id: "req-1",
					command: "prompt",
				}),
			),
		);

		expect(failure.code).toBe("invalid_request");
	});

	test("wraps existing PlotSessionEvent without changing payload", () => {
		const event = new SessionStartedEvent({
			type: "session_started",
			sessionId,
			sequence: plotSessionEventSequence(1),
		});

		const record = makePlotEventRecord(epoch, event);

		expect(record).toEqual(
			expect.objectContaining({
				protocol: "plot.v1",
				kind: "event",
				sessionId,
				epoch,
				sequence: plotSessionEventSequence(1),
			}),
		);
		expect(record.event).toBe(event);
	});

	test("constructs hello and response records", () => {
		const hello = new PlotHelloRecord({
			protocol: "plot.v1",
			kind: "hello",
			sessionId,
			epoch,
			firstEventSeq: plotProtocolSequence(0),
			lastEventSeq: plotProtocolSequence(3),
			capabilities: ["stdio_jsonl"],
			limits: defaultPlotProtocolLimits,
		});
		const success = makePlotSuccessResponse({
			id: plotProtocolRequestId("req-2"),
			command: "tick_once",
			lastEventSeq: plotProtocolSequence(3),
			data: { tickId: tickId(1) },
		});
		const failure = makePlotErrorResponse({
			id: plotProtocolRequestId("req-3"),
			command: "subscribe",
			lastEventSeq: plotProtocolSequence(3),
			code: "cursor_expired",
			message: "event cursor is no longer retained",
		});

		expect(hello.kind).toBe("hello");
		expect(success.ok).toBe(true);
		expect(success.data).toEqual({ tickId: tickId(1) });
		expect(failure.ok).toBe(false);
		expect(failure.error.code).toBe("cursor_expired");
	});
});
