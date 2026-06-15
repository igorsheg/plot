import { describe, expect, test } from "bun:test";
import {
	safeParsePlotClientRecord,
	safeParseSubmitObservationParams,
} from "../src/protocol.js";
import { safeParseSessionHistoryEvent } from "../src/session-history.js";

const request = {
	protocol: "plot.v1",
	kind: "request",
	id: "req-1",
	command: "submit_observation",
	params: {
		observation: {
			type: "operator.note",
			data: { message: "continue" },
		},
	},
};

describe("@plot/control browser-safe schemas", () => {
	test("validates protocol and history boundaries with safeParse", () => {
		const parsedRequest = safeParsePlotClientRecord(request);
		expect(parsedRequest.success).toBe(true);

		const parsedParams = safeParseSubmitObservationParams(request.params);
		expect(parsedParams.success).toBe(true);

		const parsedHistory = safeParseSessionHistoryEvent({
			sessionId: "session-1",
			epoch: "epoch-1",
			sequence: 1,
			timestamp: "2026-06-15T00:00:00.000Z",
			type: "operator_observation_recorded",
			payload: {
				sessionId: "session-1",
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

	test("rejects invalid protocol envelopes before runtime handling", () => {
		const parsed = safeParsePlotClientRecord({
			protocol: "plot.v1",
			kind: "request",
			id: "req-1",
			command: "prompt",
		});

		expect(parsed.success).toBe(false);
	});
});
