import { expect, test } from "bun:test";
import { AsyncQueue } from "@plot/common/async-queue";
import { makeSessionProtocol } from "../src/protocol.js";
import {
	ProtocolBoundaryError,
	sessionProtocolVersion,
	type ClientRequest,
} from "../src/protocol.js";
import {
	decodeClientRequestLine,
	decodeServerRecordLine,
	encodeServerRecordLine,
	type ServerRecord,
} from "../src/protocol.js";
import type { RuntimeEvent, SessionRuntime } from "../src/runtime.js";

const request = (
	method: ClientRequest["method"],
	params = {},
): ClientRequest => ({
	protocol: sessionProtocolVersion,
	kind: "request",
	id: method,
	method,
	params,
});

const runtime = (overrides: Partial<SessionRuntime> = {}): SessionRuntime => ({
	id: "session-1",
	start: async () => {},
	runOnce: async () => ({
		tickId: 1,
		selected: 0,
		started: 0,
		running: 0,
		completions: 0,
		diagnostics: [],
	}),
	tickOnce: async () => ({
		tickId: 1,
		selected: 0,
		started: 0,
		running: 0,
		completions: 0,
		diagnostics: [],
	}),
	state: async () => ({ sessionId: "session-1" }),
	schedulerSnapshot: async () => ({
		tickId: 1,
		work: [
			{
				workKey: "work-1",
				sourceId: "source-1",
				status: "pending",
			},
		],
		running: [],
		scheduledWakes: [],
		diagnostics: [],
	}),
	pauseDispatch: async () => {},
	resumeDispatch: async () => {},
	interruptAgentRun: async () => true,
	recordOperatorObservation: async () => true,
	events: async function* () {},
	appendAgentEvent: async (input) => ({
		kind: "agent_event",
		sessionId: "session-1",
		sequence: 1,
		timestamp: "2026-01-01T00:00:00.000Z",
		sourceId: input.sourceId,
		runId: input.runId,
		workKey: input.workKey,
		event: input.event,
	}),
	lastEventSequence: async () => 0,
	shutdown: async () => true,
	...overrides,
});

test("protocol codec decodes valid requests and rejects invalid records", () => {
	const decoded = decodeClientRequestLine(JSON.stringify(request("ping")));
	expect(decoded.method).toBe("ping");
	expect(() =>
		decodeClientRequestLine(JSON.stringify({ kind: "request" })),
	).toThrow(ProtocolBoundaryError);
	expect(() =>
		decodeServerRecordLine(
			JSON.stringify({
				protocol: sessionProtocolVersion,
				kind: "event",
			}),
		),
	).toThrow(ProtocolBoundaryError);
});

test("protocol adapter dispatches lifecycle commands", async () => {
	const calls: string[] = [];
	const protocol = makeSessionProtocol({
		runtime: runtime({
			start: async () => {
				calls.push("start");
			},
			pauseDispatch: async () => {
				calls.push("pause");
			},
			resumeDispatch: async () => {
				calls.push("resume");
			},
			interruptAgentRun: async ({ runId }) => {
				calls.push(`interrupt:${runId}`);
				return true;
			},
			recordOperatorObservation: async ({ actionId, workKey }) => {
				calls.push(`observe:${workKey}:${actionId}`);
				return true;
			},
			shutdown: async () => {
				calls.push("shutdown");
				return true;
			},
		}),
	});

	await protocol.submit(request("session.start"));
	await protocol.submit(request("session.dispatch.pause"));
	await protocol.submit(request("session.dispatch.resume"));
	await protocol.submit(request("agent.interrupt", { runId: "run-1" }));
	await protocol.submit(
		request("operator.observe", {
			sourceId: "source-1",
			workKey: "work-1",
			actionId: "approve",
			actionLabel: "Approve",
		}),
	);

	await protocol.submit(request("session.shutdown"));
	await protocol.close();

	expect(calls).toEqual([
		"start",
		"pause",
		"resume",
		"interrupt:run-1",
		"observe:work-1:approve",
		"shutdown",
	]);
});

test("protocol exposes JSON-safe live scheduler state", async () => {
	const protocol = makeSessionProtocol({ runtime: runtime() });
	const output = protocol.output();

	await protocol.submit(request("work.list"));

	for await (const record of output) {
		if (record.kind !== "response" || record.method !== "work.list") continue;
		expect(record).toMatchObject({
			ok: true,
			data: { work: [{ workKey: "work-1", sourceId: "source-1" }] },
		});
		break;
	}
	await protocol.close();
});

test("protocol shutdown can be owned by the embedding host", async () => {
	const calls: string[] = [];
	const protocol = makeSessionProtocol({
		runtime: runtime({
			shutdown: async () => {
				calls.push("runtime.shutdown");
				return true;
			},
		}),
		shutdown: async () => {
			calls.push("host.shutdown");
			return true;
		},
	});

	await protocol.submit(request("session.shutdown"));
	await protocol.close();

	expect(calls).toEqual(["host.shutdown"]);
});

test("session.tick returns a sequence fence after the tick", async () => {
	let sequence = 0;
	const protocol = makeSessionProtocol({
		runtime: runtime({
			tickOnce: async () => {
				sequence = 7;
				return {
					tickId: 1,
					selected: 0,
					started: 0,
					running: 0,
					completions: 0,
					diagnostics: [],
				};
			},
			lastEventSequence: async () => sequence,
		}),
	});

	await protocol.submit(request("session.tick"));
	const record = await protocol.output()[Symbol.asyncIterator]().next();

	expect(record.value).toMatchObject({
		kind: "response",
		method: "session.tick",
		lastSequence: 7,
	});
	await protocol.close();
});

test("events never evict protocol responses", async () => {
	const runtimeEvents = new AsyncQueue<RuntimeEvent>();
	const protocol = makeSessionProtocol({
		limits: {
			maxInputLineBytes: 1024,
			maxOutputLineBytes: 2048,
			maxPendingRequests: 1,
			maxBufferedEvents: 1,
		},
		runtime: runtime({ events: () => runtimeEvents }),
	});
	await protocol.submit({ ...request("ping"), id: "response" });
	for (const sequence of [1, 2])
		runtimeEvents.offer({
			kind: "session_event",
			sessionId: "session-1",
			sequence,
			timestamp: "2026-01-01T00:00:00.000Z",
			event: { type: "session_started" },
		});
	await new Promise((resolve) => setTimeout(resolve, 0));

	const iterator = protocol.output()[Symbol.asyncIterator]();
	const records = [
		(await iterator.next()).value,
		(await iterator.next()).value,
	];

	expect(records).toContainEqual(
		expect.objectContaining({ kind: "response", id: "response", ok: true }),
	);
	expect(records).toContainEqual(
		expect.objectContaining({
			kind: "event",
			event: expect.objectContaining({ sequence: 2 }),
		}),
	);
	runtimeEvents.close();
	await protocol.close();
});

test("protocol responses apply bounded backpressure", async () => {
	const protocol = makeSessionProtocol({
		limits: {
			maxInputLineBytes: 1024,
			maxOutputLineBytes: 2048,
			maxPendingRequests: 1,
			maxBufferedEvents: 1,
		},
		runtime: runtime(),
	});
	await protocol.submit({ ...request("ping"), id: "first" });
	let secondSettled = false;
	const second = protocol
		.submit({ ...request("ping"), id: "second" })
		.then((accepted) => {
			secondSettled = true;
			return accepted;
		});
	await Promise.resolve();
	await Promise.resolve();
	expect(secondSettled).toBe(false);

	const iterator = protocol.output()[Symbol.asyncIterator]();
	expect((await iterator.next()).value).toMatchObject({ id: "first" });
	expect(await second).toBe(true);
	expect((await iterator.next()).value).toMatchObject({ id: "second" });
	await protocol.close();
});

test("protocol close releases response backpressure", async () => {
	const protocol = makeSessionProtocol({
		limits: {
			maxInputLineBytes: 1024,
			maxOutputLineBytes: 2048,
			maxPendingRequests: 1,
			maxBufferedEvents: 1,
		},
		runtime: runtime(),
	});
	await protocol.submit({ ...request("ping"), id: "first" });
	const second = protocol.submit({ ...request("ping"), id: "second" });
	await Promise.resolve();
	await protocol.close();
	expect(await second).toBe(false);
});

test("protocol close aborts an active request", async () => {
	const never = new Promise<void>(() => {});
	const protocol = makeSessionProtocol({
		runtime: runtime({ start: async () => never }),
	});
	const submitted = protocol.submit(request("session.start"));
	await Promise.resolve();
	await protocol.close();
	expect(await submitted).toBe(false);
});

test("protocol close aborts a live event subscription", async () => {
	const liveEvents = new AsyncQueue<RuntimeEvent>();
	const protocol = makeSessionProtocol({
		runtime: runtime({
			events: (signal) => {
				signal?.addEventListener("abort", () => liveEvents.close(), {
					once: true,
				});
				return liveEvents;
			},
		}),
	});

	await protocol.close();
});

test("protocol adapter reports request queue overflow", async () => {
	let releaseStart!: () => void;
	const blockedStart = new Promise<void>((resolve) => {
		releaseStart = resolve;
	});
	const protocol = makeSessionProtocol({
		limits: {
			maxInputLineBytes: 1024,
			maxOutputLineBytes: 2048,
			maxPendingRequests: 1,
			maxBufferedEvents: 8,
		},
		runtime: runtime({ start: async () => blockedStart }),
	});
	const output = protocol.output();
	const started = protocol.submit(request("session.start"));
	await Promise.resolve();
	void protocol.submit(request("ping"));
	const accepted = await protocol.submit({
		...request("ping"),
		id: "overflow",
	});

	expect(accepted).toBe(false);
	for await (const record of output) {
		if (record.kind !== "response" || record.id !== "overflow") continue;
		expect(record).toMatchObject({
			ok: false,
			error: { code: "request_queue_full" },
		});
		break;
	}
	releaseStart();
	await started;
	await protocol.close();
});

test("protocol encodes server records as JSONL", async () => {
	const protocol = makeSessionProtocol({ runtime: runtime() });
	const line = encodeServerRecordLine(await protocol.welcome());
	expect(line.endsWith("\n")).toBe(true);
	await protocol.close();
});

test("server record round trip", () => {
	const record: ServerRecord = {
		protocol: sessionProtocolVersion,
		kind: "event",
		event: {
			kind: "session_event",
			sessionId: "s",
			sequence: 3,
			timestamp: "2026-01-01T00:00:00.000Z",
			event: {
				type: "attempt_completed",
				completion: {
					runId: "r1",
					sourceId: "src",
					workKey: "w1",
					status: "succeeded",
				},
			},
		},
	};
	expect(decodeServerRecordLine(encodeServerRecordLine(record))).toEqual(
		record,
	);
});

test("rejects stale protocol lines", () => {
	const line =
		'{"protocol":"plot.session.v2","kind":"event","sequence":1,"event":{}}';
	expect(() => decodeServerRecordLine(line)).toThrow(ProtocolBoundaryError);
	try {
		decodeServerRecordLine(line);
	} catch (error) {
		expect(error).toBeInstanceOf(ProtocolBoundaryError);
		expect((error as Error).message).toContain("plot.session.v2");
	}
});
