import { describe, expect, test } from "bun:test";
import {
	plotProtocolVersion,
	safeParseAttachSessionParams,
	safeParsePlotClientRecord,
	safeParseRequestTickParams,
} from "../src/protocol.js";
import { safeParseSessionHistoryEvent } from "../src/session-history.js";

const request = {
	protocol: plotProtocolVersion,
	kind: "request",
	id: "req-1",
	command: "request_tick",
	params: { sessionId: "session-1" },
};

describe("@plot/control browser-safe schemas", () => {
	test("validates explicit protocol and history boundaries with safeParse", () => {
		const parsedRequest = safeParsePlotClientRecord(request);
		expect(parsedRequest.success).toBe(true);

		const parsedParams = safeParseRequestTickParams(request.params);
		expect(parsedParams.success).toBe(true);

		const parsedHistory = safeParseSessionHistoryEvent({
			sessionId: "session-1",
			epoch: "epoch-1",
			sequence: 1,
			timestamp: "2026-06-15T00:00:00.000Z",
			type: "operator_observation_recorded",
			payload: {
				sessionId: "session-1",
				sourceId: "source-1",
				workKey: "work:1",
				actionId: "approve",
				actionLabel: "Approve",
				timestamp: "2026-06-15T00:00:00.000Z",
			},
		});
		expect(parsedHistory.success).toBe(true);
		expect(
			safeParseSessionHistoryEvent({
				sessionId: "session-1",
				epoch: "epoch-1",
				sequence: 2,
				timestamp: "2026-06-15T00:00:01.000Z",
				type: "operator_observation_recorded",
				payload: {},
			}).success,
		).toBe(false);
	});

	test("rejects old implicit envelopes and missing session ids", () => {
		expect(
			safeParsePlotClientRecord({
				protocol: plotProtocolVersion,
				kind: "request",
				id: "req-1",
				command: "tick_once",
			}).success,
		).toBe(false);
		expect(safeParseAttachSessionParams({ afterSequence: 0 }).success).toBe(
			false,
		);
	});
});
