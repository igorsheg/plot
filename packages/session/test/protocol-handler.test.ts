import { describe, expect, test } from "bun:test";
import { Deferred, Effect, Fiber, Layer, Stream } from "effect";
import { positiveInt, setFact, sourceId, workKey } from "@plot/agent/model";
import type { WorkRunner } from "@plot/agent/work-runner";
import type { WorkSource } from "@plot/agent/work-source";
import { makePlotSessionLayer } from "../src/plot-session.js";
import type { PlotAuthShape } from "../src/pi-auth.js";
import {
	PlotClientRequestRecord,
	PlotProtocolLimits,
	defaultPlotProtocolLimits,
	plotProtocolEpoch,
	plotProtocolRequestId,
	plotProtocolSequence,
	type PlotServerRecord,
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

const testLayer = (options: { readonly auth?: PlotAuthShape } = {}) => {
	const key = workKey("protocol:1");
	const completedFact = "protocol:completed";
	const source: WorkSource = {
		id: sourceId("protocol-source"),
		reconcile: ({ snapshot }) => {
			const completed = snapshot.completions.some(
				(completion) => completion.workKey === key,
			);
			if (!completed) return Effect.succeed([]);
			return Effect.succeed([setFact(completedFact, true)]);
		},
		selectWork: ({ snapshot }) => {
			if (snapshot.facts.get(completedFact) === true) {
				return Effect.succeed([]);
			}
			return Effect.succeed([{ workKey: key }]);
		},
	};
	const runner: WorkRunner = {
		run: () => Effect.succeed({}),
	};
	return makePlotProtocolLayer({
		epoch: plotProtocolEpoch("epoch-1"),
		...(options.auth === undefined ? {} : { auth: options.auth }),
	}).pipe(
		Layer.provide(
			makePlotSessionLayer({ workflow, sources: [source], runner }),
		),
	);
};

const observationTestLayer = (
	options: {
		readonly maxObservationPayloadBytes?: number;
	} = {},
) => {
	const source: WorkSource = {
		id: sourceId("observation-source"),
		reconcile: ({ snapshot }) =>
			Effect.succeed(
				snapshot.observations.map((observation) =>
					setFact(`observation:${observation.type}`, observation.data),
				),
			),
	};
	const runner: WorkRunner = {
		run: () => Effect.succeed({}),
	};
	const limits = new PlotProtocolLimits({
		...defaultPlotProtocolLimits,
		...(options.maxObservationPayloadBytes === undefined
			? {}
			: {
					maxObservationPayloadBytes: positiveInt(
						options.maxObservationPayloadBytes,
					),
				}),
	});
	return makePlotProtocolLayer({
		epoch: plotProtocolEpoch("epoch-1"),
		limits,
	}).pipe(
		Layer.provide(
			makePlotSessionLayer({ workflow, sources: [source], runner }),
		),
	);
};

const fakeAuth = (): PlotAuthShape => ({
	providers: async () => [
		{
			id: "fake-oauth",
			name: "Fake OAuth",
			usesCallbackServer: false,
			configured: false,
		},
	],
	listModels: async () => [],
	status: async (provider) => [
		{
			provider: provider ?? "fake-oauth",
			configured: provider === "fake-oauth",
			source: "stored",
		},
	],
	login: async (options) => {
		options.events?.deviceCode?.({
			userCode: "ABCD-1234",
			verificationUri: "https://example.test/device",
		});
	},
	logout: async () => {},
});

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

	test("accepts submitted observations into the Plot loop mailbox", async () => {
		const records = await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const protocol = yield* PlotProtocol;
					const done = yield* Deferred.make<readonly PlotServerRecord[]>();
					const outputRecords: PlotServerRecord[] = [];
					yield* protocol.output().pipe(
						Stream.runForEach((record) => {
							outputRecords.push(record);
							if (
								record.kind === "response" &&
								record.id === plotProtocolRequestId("req-3")
							) {
								return Deferred.succeed(done, [...outputRecords]).pipe(
									Effect.asVoid,
								);
							}
							return Effect.void;
						}),
						Effect.forkScoped({ startImmediately: true }),
						Effect.asVoid,
					);
					yield* Effect.yieldNow;
					yield* protocol.submit(
						request("req-1", "submit_observation", {
							observation: {
								type: "github.pr.updated",
								subject: "github:acme/web:pr:42",
								data: { headSha: "sha-2" },
							},
						}),
					);
					yield* protocol.submit(request("req-2", "tick_once"));
					yield* protocol.submit(request("req-3", "get_snapshot"));
					return yield* Deferred.await(done);
				}),
			).pipe(Effect.provide(observationTestLayer())),
		);

		const submitResponse = records.find(
			(record) =>
				record.kind === "response" &&
				record.id === plotProtocolRequestId("req-1"),
		);
		const snapshotResponse = records.find(
			(record) =>
				record.kind === "response" &&
				record.id === plotProtocolRequestId("req-3"),
		);
		expect(submitResponse).toEqual(
			expect.objectContaining({
				kind: "response",
				command: "submit_observation",
				ok: true,
				data: { accepted: true },
			}),
		);
		expect(
			(
				(
					snapshotResponse as Extract<
						PlotServerRecord,
						{ kind: "response"; ok: true }
					>
				).data as { snapshot: { facts: ReadonlyMap<string, unknown> } }
			).snapshot.facts.get("observation:github.pr.updated"),
		).toEqual({ headSha: "sha-2" });
	});

	test("rejects submitted observations over the payload limit", async () => {
		const records = await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const protocol = yield* PlotProtocol;
					const fiber = yield* protocol
						.output()
						.pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped);
					yield* Effect.yieldNow;
					yield* protocol.submit(
						request("req-1", "submit_observation", {
							observation: {
								type: "large.payload",
								data: { text: "x".repeat(128) },
							},
						}),
					);
					return yield* Fiber.join(fiber);
				}),
			).pipe(
				Effect.provide(
					observationTestLayer({ maxObservationPayloadBytes: 32 }),
				),
			),
		);

		expect(records[0]).toEqual(
			expect.objectContaining({
				kind: "response",
				command: "submit_observation",
				ok: false,
				error: expect.objectContaining({ code: "payload_too_large" }),
			}),
		);
	});

	test("serves auth provider/status commands through protocol responses", async () => {
		const records = await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const protocol = yield* PlotProtocol;
					const fiber = yield* protocol
						.output()
						.pipe(Stream.take(2), Stream.runCollect, Effect.forkScoped);
					yield* Effect.yieldNow;
					yield* protocol.submit(request("req-1", "auth_providers"));
					yield* protocol.submit(
						request("req-2", "auth_status", { provider: "fake-oauth" }),
					);
					return yield* Fiber.join(fiber);
				}),
			).pipe(Effect.provide(testLayer({ auth: fakeAuth() }))),
		);

		expect(records[0]).toEqual(
			expect.objectContaining({
				kind: "response",
				command: "auth_providers",
				ok: true,
				data: {
					providers: [expect.objectContaining({ id: "fake-oauth" })],
				},
			}),
		);
		expect(records[1]).toEqual(
			expect.objectContaining({
				kind: "response",
				command: "auth_status",
				ok: true,
				data: {
					status: [
						expect.objectContaining({
							provider: "fake-oauth",
							configured: true,
						}),
					],
				},
			}),
		);
	});

	test("emits auth login protocol events before auth response", async () => {
		const records = await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const protocol = yield* PlotProtocol;
					const fiber = yield* protocol
						.output()
						.pipe(Stream.take(3), Stream.runCollect, Effect.forkScoped);
					yield* Effect.yieldNow;
					yield* protocol.submit(
						request("req-1", "auth_login", { provider: "fake-oauth" }),
					);
					return yield* Fiber.join(fiber);
				}),
			).pipe(Effect.provide(testLayer({ auth: fakeAuth() }))),
		);

		expect(records.map((record) => record.kind)).toEqual([
			"event",
			"event",
			"event",
		]);
		expect(records[0]).toEqual(
			expect.objectContaining({
				kind: "event",
				event: expect.objectContaining({ type: "auth_login_started" }),
			}),
		);
		expect(records[1]).toEqual(
			expect.objectContaining({
				kind: "event",
				event: expect.objectContaining({ type: "auth_device_code" }),
			}),
		);
		expect(records[2]).toEqual(
			expect.objectContaining({
				kind: "event",
				event: expect.objectContaining({ type: "auth_login_succeeded" }),
			}),
		);
	});

	test("replays retained events for subscribe cursors", async () => {
		const records = await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const protocol = yield* PlotProtocol;
					const done = yield* Deferred.make<void>();
					const outputRecords: PlotServerRecord[] = [];
					const fiber = yield* protocol.output().pipe(
						Stream.runForEach((record) => {
							outputRecords.push(record);
							if (
								record.kind === "response" &&
								record.id === plotProtocolRequestId("req-2")
							) {
								return Deferred.succeed(done, undefined).pipe(Effect.asVoid);
							}
							return Effect.void;
						}),
						Effect.forkScoped,
					);
					yield* Effect.yieldNow;
					yield* protocol.submit(request("req-1", "start"));
					yield* protocol.submit(
						request("req-2", "subscribe", { afterSequence: 0 }),
					);
					yield* Deferred.await(done);
					yield* Fiber.interrupt(fiber);
					return outputRecords;
				}),
			).pipe(Effect.provide(testLayer())),
		);

		const startResponseIndex = records.findIndex(
			(record) =>
				record.kind === "response" &&
				record.id === plotProtocolRequestId("req-1"),
		);
		const subscribeResponseIndex = records.findIndex(
			(record) =>
				record.kind === "response" &&
				record.id === plotProtocolRequestId("req-2"),
		);
		const firstEvent = records.find((record) => record.kind === "event");
		const replayedEvents = records
			.slice(startResponseIndex + 1, subscribeResponseIndex)
			.filter((record) => record.kind === "event");
		const subscribeResponse = records[subscribeResponseIndex];

		if (firstEvent === undefined) {
			throw new Error("missing start event");
		}
		expect(startResponseIndex).toBeGreaterThan(0);
		expect(subscribeResponseIndex).toBeGreaterThan(startResponseIndex);
		expect(replayedEvents).toContainEqual(firstEvent);
		expect(subscribeResponse).toEqual(
			expect.objectContaining({
				kind: "response",
				id: plotProtocolRequestId("req-2"),
				command: "subscribe",
				ok: true,
			}),
		);
		if (subscribeResponse?.kind !== "response") {
			throw new Error("missing subscribe response");
		}
		expect(Number(subscribeResponse.lastEventSeq)).toBeGreaterThan(0);
	});
});
