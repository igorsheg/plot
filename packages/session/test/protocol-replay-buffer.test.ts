import { describe, expect, test } from "bun:test";
import { positiveInt } from "@plot/agent/model";
import type { SessionHistoryEvent } from "@plot/control/session-history";
import {
	defaultPlotProtocolLimits,
	makePlotSessionEventRecord,
	plotProtocolSequence,
} from "../src/protocol.js";
import { makePlotProtocolReplayBuffer } from "../src/protocol-replay-buffer.js";

const historyEvent = (sequence: number): SessionHistoryEvent => ({
	sessionId: "session-1",
	epoch: "epoch-1",
	sequence,
	timestamp: "2026-06-15T00:00:00.000Z",
	type: "session_started",
	payload: {},
});

describe("plot protocol replay buffer", () => {
	test("replays retained events after a cursor", async () => {
		const buffer = await makePlotProtocolReplayBuffer();
		await buffer.append(makePlotSessionEventRecord(historyEvent(1)));
		await buffer.append(makePlotSessionEventRecord(historyEvent(2)));
		const replayed = await buffer.replayAfter(plotProtocolSequence(1));

		expect(replayed.map((record) => Number(record.sequence))).toEqual([2]);
	});

	test("expires cursors outside the retained window", async () => {
		const buffer = await makePlotProtocolReplayBuffer({
			...defaultPlotProtocolLimits,
			maxEventBufferEvents: positiveInt(1),
		});
		await buffer.append(makePlotSessionEventRecord(historyEvent(1)));
		await buffer.append(makePlotSessionEventRecord(historyEvent(2)));
		let failure: { code: string } | undefined;
		try {
			await buffer.replayAfter(plotProtocolSequence(0));
		} catch (error) {
			failure = error as { code: string };
		}

		expect(failure?.code).toBe("cursor_expired");
	});

	test("waits until an event sequence is appended", async () => {
		const buffer = await makePlotProtocolReplayBuffer();
		const waiter = buffer.waitUntil(plotProtocolSequence(1)).then(() => "done");
		await Promise.resolve();
		await buffer.append(makePlotSessionEventRecord(historyEvent(1)));
		const completed = await waiter;

		expect(completed).toBe("done");
	});
});
