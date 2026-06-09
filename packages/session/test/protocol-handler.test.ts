import { describe, expect, test } from "bun:test";
import { Effect, Fiber, Layer, Stream } from "effect";
import { sourceId, workKey } from "@plot/agent/model";
import type { WorkRunner } from "@plot/agent/work-runner";
import type { WorkSource } from "@plot/agent/work-source";
import { makePlotSessionLayer } from "../src/plot-session.js";
import {
	PlotClientRequestRecord,
	plotProtocolEpoch,
	plotProtocolRequestId,
	plotProtocolSequence,
} from "../src/protocol.js";
import {
	PlotProtocol,
	makePlotProtocolLayer,
} from "../src/protocol-handler.js";
import type { WorkflowDefinition } from "../src/workflow.js";

const workflow: WorkflowDefinition = {
	config: {},
	runtime: {},
	prompt: "Do useful work.",
};

const request = (
	id: string,
	command: PlotClientRequestRecord["command"],
	params?: unknown,
) =>
	new PlotClientRequestRecord({
		protocol: "plot.v1",
		kind: "request",
		id: plotProtocolRequestId(id),
		command,
		...(params === undefined ? {} : { params }),
	});

const testLayer = () => {
	const source: WorkSource = {
		id: sourceId("protocol-source"),
		selectWork: () => Effect.succeed([{ workKey: workKey("protocol:1") }]),
	};
	const runner: WorkRunner = {
		run: () => Effect.succeed({}),
	};
	return makePlotProtocolLayer({ epoch: plotProtocolEpoch("epoch-1") }).pipe(
		Layer.provide(
			makePlotSessionLayer({ workflow, sources: [source], runner }),
		),
	);
};

describe("PlotProtocol handler", () => {
	test("returns hello with current replay frontier", async () => {
		const hello = await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const protocol = yield* PlotProtocol;
					return yield* protocol.hello();
				}),
			).pipe(Effect.provide(testLayer())),
		);

		expect(hello).toEqual(
			expect.objectContaining({
				protocol: "plot.v1",
				kind: "hello",
				epoch: plotProtocolEpoch("epoch-1"),
				firstEventSeq: plotProtocolSequence(0),
				lastEventSeq: plotProtocolSequence(0),
			}),
		);
	});

	test("serializes tick_once events before the command response", async () => {
		const records = await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const protocol = yield* PlotProtocol;
					const fiber = yield* protocol
						.output()
						.pipe(Stream.take(4), Stream.runCollect, Effect.forkScoped);
					yield* Effect.yieldNow;
					yield* protocol.submit(request("req-1", "tick_once"));
					return yield* Fiber.join(fiber);
				}),
			).pipe(Effect.provide(testLayer())),
		);

		expect(records.slice(0, 3).map((record) => record.kind)).toEqual([
			"event",
			"event",
			"event",
		]);
		expect(records[3]).toEqual(
			expect.objectContaining({
				kind: "response",
				id: plotProtocolRequestId("req-1"),
				command: "tick_once",
				ok: true,
				lastEventSeq: plotProtocolSequence(3),
			}),
		);
	});

	test("replays retained events for subscribe cursors", async () => {
		const records = await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const protocol = yield* PlotProtocol;
					const fiber = yield* protocol
						.output()
						.pipe(Stream.take(4), Stream.runCollect, Effect.forkScoped);
					yield* Effect.yieldNow;
					yield* protocol.submit(request("req-1", "start"));
					yield* protocol.submit(
						request("req-2", "subscribe", { afterSequence: 0 }),
					);
					return yield* Fiber.join(fiber);
				}),
			).pipe(Effect.provide(testLayer())),
		);

		expect(records.map((record) => record.kind)).toEqual([
			"event",
			"response",
			"event",
			"response",
		]);
		expect(records[2]).toEqual(records[0]);
		expect(records[3]).toEqual(
			expect.objectContaining({
				kind: "response",
				id: plotProtocolRequestId("req-2"),
				command: "subscribe",
				ok: true,
				lastEventSeq: plotProtocolSequence(1),
			}),
		);
	});
});
