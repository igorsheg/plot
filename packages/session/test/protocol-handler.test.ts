import { describe, expect, test } from "bun:test";
import { positiveInt, setFact, sourceId, workKey } from "@plot/agent/model";
import type { WorkRunner } from "@plot/agent/work-runner";
import type { WorkSource } from "@plot/agent/work-source";
import { makePlotSessionLayer } from "../src/plot-session.js";
import type { PlotAuthShape } from "../src/pi-auth.js";
import {
	defaultPlotProtocolLimits,
	plotProtocolEpoch,
	plotProtocolRequestId,
	plotProtocolSequence,
	type PlotClientRecord,
	type PlotCommand,
	type PlotProtocolLimits,
	type PlotServerRecord,
} from "../src/protocol.js";
import {
	makePlotProtocolLayer,
	type PlotProtocolShape,
} from "../src/protocol-handler.js";
import type { WorkflowDefinition } from "../src/workflow.js";

const workflow: WorkflowDefinition = {
	config: {},
	runtime: {},
	prompt: "Do useful work.",
};
const request = (
	id: string,
	command: PlotCommand,
	params?: unknown,
): PlotClientRecord => ({
	protocol: "plot.v1",
	kind: "request",
	id: plotProtocolRequestId(id),
	command,
	...(params === undefined ? {} : { params }),
});
const collectN = async <A>(
	iterable: AsyncIterable<A>,
	n: number,
): Promise<A[]> => {
	const out: A[] = [];
	for await (const item of iterable) {
		out.push(item);
		if (out.length >= n) break;
	}
	return out;
};
const collectUntil = async <A>(
	iterable: AsyncIterable<A>,
	predicate: (item: A) => boolean,
): Promise<A[]> => {
	const out: A[] = [];
	for await (const item of iterable) {
		out.push(item);
		if (predicate(item)) break;
	}
	return out;
};

const makeProtocol = (
	options: {
		readonly auth?: PlotAuthShape;
		readonly limits?: PlotProtocolLimits;
	} = {},
): PlotProtocolShape => {
	const key = workKey("protocol:1");
	const completedFact = "protocol:completed";
	const source: WorkSource = {
		id: sourceId("protocol-source"),
		reconcile: ({ snapshot }) =>
			snapshot.completions.some((completion) => completion.workKey === key)
				? [setFact(completedFact, true)]
				: [],
		selectWork: ({ snapshot }) =>
			snapshot.facts.get(completedFact) === true ? [] : [{ workKey: key }],
	};
	const runner: WorkRunner = { run: () => ({}) };
	const session = makePlotSessionLayer({ workflow, sources: [source], runner });
	return makePlotProtocolLayer({
		epoch: plotProtocolEpoch("epoch-1"),
		session,
		...(options.auth === undefined ? {} : { auth: options.auth }),
		...(options.limits === undefined ? {} : { limits: options.limits }),
	});
};

const observationProtocol = (
	options: { readonly maxObservationPayloadBytes?: number } = {},
) => {
	const source: WorkSource = {
		id: sourceId("observation-source"),
		reconcile: ({ snapshot }) =>
			snapshot.observations.map((observation) =>
				setFact(`observation:${observation.type}`, observation.data),
			),
	};
	const runner: WorkRunner = { run: () => ({}) };
	const limits: PlotProtocolLimits = {
		...defaultPlotProtocolLimits,
		...(options.maxObservationPayloadBytes === undefined
			? {}
			: {
					maxObservationPayloadBytes: positiveInt(
						options.maxObservationPayloadBytes,
					),
				}),
	};
	const session = makePlotSessionLayer({ workflow, sources: [source], runner });
	return makePlotProtocolLayer({
		epoch: plotProtocolEpoch("epoch-1"),
		limits,
		session,
	});
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
		const hello = await makeProtocol().hello();
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
		const protocol = makeProtocol();
		const pending = collectN(protocol.output(), 4);
		await Promise.resolve();
		await protocol.submit(request("req-1", "tick_once"));
		const records = await pending;
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
		const protocol = observationProtocol();
		const pending = collectUntil(
			protocol.output(),
			(record) =>
				record.kind === "response" &&
				record.id === plotProtocolRequestId("req-3"),
		);
		await Promise.resolve();
		await protocol.submit(
			request("req-1", "submit_observation", {
				observation: {
					type: "github.pr.updated",
					subject: "github:acme/web:pr:42",
					data: { headSha: "sha-2" },
				},
			}),
		);
		await protocol.submit(request("req-2", "tick_once"));
		await protocol.submit(request("req-3", "get_snapshot"));
		const records = await pending;
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
		const protocol = observationProtocol({ maxObservationPayloadBytes: 32 });
		const pending = collectN(protocol.output(), 1);
		await Promise.resolve();
		await protocol.submit(
			request("req-1", "submit_observation", {
				observation: { type: "large.payload", data: { text: "x".repeat(128) } },
			}),
		);
		const records = await pending;
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
		const protocol = makeProtocol({ auth: fakeAuth() });
		const pending = collectN(protocol.output(), 2);
		await Promise.resolve();
		await protocol.submit(request("req-1", "auth_providers"));
		await protocol.submit(
			request("req-2", "auth_status", { provider: "fake-oauth" }),
		);
		const records = await pending;
		expect(records[0]).toEqual(
			expect.objectContaining({
				kind: "response",
				command: "auth_providers",
				ok: true,
				data: { providers: [expect.objectContaining({ id: "fake-oauth" })] },
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
		const protocol = makeProtocol({ auth: fakeAuth() });
		const pending = collectN(protocol.output(), 3);
		await Promise.resolve();
		await protocol.submit(
			request("req-1", "auth_login", { provider: "fake-oauth" }),
		);
		const records = await pending;
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
		const protocol = makeProtocol();
		const pending = collectUntil(
			protocol.output(),
			(record) =>
				record.kind === "response" &&
				record.id === plotProtocolRequestId("req-2"),
		);
		await Promise.resolve();
		await protocol.submit(request("req-1", "start"));
		await protocol.submit(request("req-2", "subscribe", { afterSequence: 0 }));
		const records = await pending;
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
		if (firstEvent === undefined) throw new Error("missing start event");
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
		if (subscribeResponse?.kind !== "response")
			throw new Error("missing subscribe response");
		expect(Number(subscribeResponse.lastEventSeq)).toBeGreaterThan(0);
	});
});
