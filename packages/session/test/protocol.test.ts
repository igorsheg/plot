import { expect, test } from "bun:test";
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
import type { SessionRuntime } from "../src/runtime.js";

const request = (
	command: ClientRequest["command"],
	params = {},
): ClientRequest => ({
	protocol: sessionProtocolVersion,
	kind: "request",
	id: command,
	command,
	params,
});

const runtime = (overrides: Partial<SessionRuntime> = {}): SessionRuntime => ({
	id: "session-1",
	start: async () => {},
	tickOnce: async () => ({
		tickId: 1,
		selected: 0,
		started: 0,
		running: 0,
		completions: 0,
		diagnostics: [],
	}),
	state: async () => ({ sessionId: "session-1" }),
	snapshot: async () => ({
		sessionId: "session-1",
		work: {},
		running: {},
		facts: {},
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
	expect(decoded.command).toBe("ping");
	expect(() =>
		decodeClientRequestLine(JSON.stringify({ kind: "request" })),
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

	await protocol.submit(request("start"));
	await protocol.submit(request("pause_dispatch"));
	await protocol.submit(request("resume_dispatch"));
	await protocol.submit(request("interrupt_agent_run", { runId: "run-1" }));
	await protocol.submit(
		request("record_operator_observation", {
			sourceId: "source-1",
			workKey: "work-1",
			actionId: "approve",
			actionLabel: "Approve",
		}),
	);
	await protocol.submit(request("shutdown"));
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
	const started = protocol.submit(request("start"));
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

test("rejects pre-v3 protocol lines", () => {
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
