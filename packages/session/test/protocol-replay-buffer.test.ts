import { describe, expect, test } from "bun:test";
import { positiveInt } from "@plot/agent/model";
import {
	SessionStartedEvent,
	plotSessionEventSequence,
	plotSessionId,
} from "../src/plot-session.js";
import {
	defaultPlotProtocolLimits,
	makePlotEventRecord,
	plotProtocolEpoch,
	plotProtocolSequence,
} from "../src/protocol.js";
import { makePlotProtocolReplayBuffer } from "../src/protocol-replay-buffer.js";

const sessionId = plotSessionId("default");
const epoch = plotProtocolEpoch("epoch-1");

const sessionStarted = (sequence: number) =>
	new SessionStartedEvent({
		sessionId,
		sequence: plotSessionEventSequence(sequence),
	});

describe("plot protocol replay buffer", () => {
	test("replays retained events after a cursor", async () => {
		const buffer = await makePlotProtocolReplayBuffer();
		await buffer.append(makePlotEventRecord(epoch, sessionStarted(1)));
		await buffer.append(makePlotEventRecord(epoch, sessionStarted(2)));
		const replayed = await buffer.replayAfter(plotProtocolSequence(1));

		expect(replayed.map((record) => Number(record.sequence))).toEqual([2]);
	});

	test("expires cursors outside the retained window", async () => {
		const buffer = await makePlotProtocolReplayBuffer({
			...defaultPlotProtocolLimits,
			maxEventBufferEvents: positiveInt(1),
		});
		await buffer.append(makePlotEventRecord(epoch, sessionStarted(1)));
		await buffer.append(makePlotEventRecord(epoch, sessionStarted(2)));
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
		await buffer.append(makePlotEventRecord(epoch, sessionStarted(1)));
		const completed = await waiter;

		expect(completed).toBe("done");
	});
});
