import { describe, expect, test } from "bun:test";
import { Effect, Fiber } from "effect";
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
		type: "session_started",
		sessionId,
		sequence: plotSessionEventSequence(sequence),
	});

describe("plot protocol replay buffer", () => {
	test("replays retained events after a cursor", async () => {
		const replayed = await Effect.runPromise(
			Effect.gen(function* () {
				const buffer = yield* makePlotProtocolReplayBuffer();
				yield* buffer.append(makePlotEventRecord(epoch, sessionStarted(1)));
				yield* buffer.append(makePlotEventRecord(epoch, sessionStarted(2)));
				return yield* buffer.replayAfter(plotProtocolSequence(1));
			}),
		);

		expect(replayed.map((record) => Number(record.sequence))).toEqual([2]);
	});

	test("expires cursors outside the retained window", async () => {
		const failure = await Effect.runPromise(
			Effect.gen(function* () {
				const buffer = yield* makePlotProtocolReplayBuffer({
					...defaultPlotProtocolLimits,
					maxEventBufferEvents: positiveInt(1),
				});
				yield* buffer.append(makePlotEventRecord(epoch, sessionStarted(1)));
				yield* buffer.append(makePlotEventRecord(epoch, sessionStarted(2)));
				return yield* Effect.flip(buffer.replayAfter(plotProtocolSequence(0)));
			}),
		);

		expect(failure.code).toBe("cursor_expired");
	});

	test("waits until an event sequence is appended", async () => {
		const completed = await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const buffer = yield* makePlotProtocolReplayBuffer();
					const waiter = yield* buffer
						.waitUntil(plotProtocolSequence(1))
						.pipe(Effect.as("done"), Effect.forkScoped);
					yield* Effect.yieldNow;
					yield* buffer.append(makePlotEventRecord(epoch, sessionStarted(1)));
					return yield* Fiber.join(waiter);
				}),
			),
		);

		expect(completed).toBe("done");
	});
});
