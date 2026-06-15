import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import type { WorkRunner } from "@plot/agent/work-runner";
import { makePlotSessionLayer } from "../src/plot-session.js";
import {
	plotProtocolRequestId,
	plotProtocolVersion,
	type PlotClientRecord,
	type PlotCommand,
	type PlotServerRecord,
} from "../src/protocol.js";
import { makePlotProtocolLayer } from "../src/protocol-handler.js";
import { createSessionHistoryStore } from "../src/session-history.js";
import type { WorkflowDefinition } from "../src/workflow.js";

const workflow: WorkflowDefinition = {
	config: {},
	runtime: { name: "protocol-test" },
	prompt: "Do useful work.",
};

const runner: WorkRunner = { run: () => ({}) };

const request = (
	id: string,
	command: PlotCommand,
	params?: unknown,
): PlotClientRecord => ({
	protocol: plotProtocolVersion,
	kind: "request",
	id: plotProtocolRequestId(id),
	command,
	...(params === undefined ? {} : { params }),
});

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

const makeProtocol = async (sessionId = "session-1") => {
	const sessionDir = await mkdtemp(join(tmpdir(), "plot-protocol-"));
	const history = await createSessionHistoryStore({ sessionDir, sessionId });
	const session = makePlotSessionLayer({
		id: sessionId,
		workflow,
		sources: [],
		runner,
		sessionHistory: history,
	});
	return {
		session,
		history,
		protocol: makePlotProtocolLayer({ session, sessionHistory: history }),
	};
};

const responseFor = (id: string) => (record: PlotServerRecord) =>
	record.kind === "response" && record.id === id;

describe("explicit Plot control protocol", () => {
	test("has no hidden current session for session-scoped commands", async () => {
		const { protocol } = await makeProtocol();
		const pending = collectUntil(protocol.output(), responseFor("req-1"));
		await protocol.submit(request("req-1", "request_tick"));
		const records = await pending;
		const response = records.at(-1);

		expect(response).toEqual(
			expect.objectContaining({
				kind: "response",
				ok: false,
				error: expect.objectContaining({ code: "invalid_request" }),
			}),
		);
	});

	test("attach returns snapshot and replays Session History by sequence", async () => {
		const { protocol } = await makeProtocol();
		let pending = collectUntil(protocol.output(), responseFor("attach-1"));
		await protocol.submit(
			request("attach-1", "attach_session", {
				sessionId: "session-1",
				role: "controller",
				afterSequence: 0,
			}),
		);
		await pending;

		pending = collectUntil(protocol.output(), responseFor("tick-1"));
		await protocol.submit(
			request("tick-1", "request_tick", { sessionId: "session-1" }),
		);
		await pending;

		pending = collectUntil(protocol.output(), responseFor("detach-1"));
		await protocol.submit(
			request("detach-1", "detach_session", { sessionId: "session-1" }),
		);
		await pending;

		pending = collectUntil(
			protocol.output(),
			(record) =>
				record.kind === "session_event" && Number(record.sequence) >= 2,
		);
		await protocol.submit(
			request("attach-2", "attach_session", {
				sessionId: "session-1",
				role: "observer",
				afterSequence: 0,
			}),
		);
		const records = await pending;
		const attach = records.find(responseFor("attach-2"));
		const replayed = records.filter(
			(record) => record.kind === "session_event",
		);

		expect(attach).toEqual(
			expect.objectContaining({
				kind: "response",
				ok: true,
				lastSequence: expect.any(Number),
				data: expect.objectContaining({ snapshot: expect.any(Object) }),
			}),
		);
		expect(replayed.map((record) => Number(record.sequence))).toEqual([1, 2]);
		expect(
			replayed.every((record) => record.event.sequence === record.sequence),
		).toBe(true);
	});

	test("detach stops only the client attachment and does not close the session", async () => {
		const { protocol } = await makeProtocol();
		let pending = collectUntil(protocol.output(), responseFor("attach"));
		await protocol.submit(
			request("attach", "attach_session", {
				sessionId: "session-1",
				role: "controller",
			}),
		);
		await pending;

		pending = collectUntil(protocol.output(), responseFor("detach"));
		await protocol.submit(
			request("detach", "detach_session", { sessionId: "session-1" }),
		);
		await pending;

		pending = collectUntil(protocol.output(), responseFor("list"));
		await protocol.submit(request("list", "list_sessions"));
		const records = await pending;
		const list = records.at(-1);
		const sessions =
			list?.kind === "response" && list.ok
				? (list.data as { sessions: readonly { id: string; state: string }[] })
						.sessions
				: [];
		expect(sessions).toContainEqual(
			expect.objectContaining({ id: "session-1" }),
		);
		expect(sessions[0]?.state).not.toBe("stopped");
	});

	test("controller role can mutate while observer role cannot", async () => {
		const { protocol } = await makeProtocol();
		let pending = collectUntil(protocol.output(), responseFor("observer"));
		await protocol.submit(
			request("observer", "attach_session", {
				sessionId: "session-1",
				role: "observer",
			}),
		);
		await pending;

		pending = collectUntil(protocol.output(), responseFor("pause-observer"));
		await protocol.submit(
			request("pause-observer", "pause_session", { sessionId: "session-1" }),
		);
		let records = await pending;
		expect(records.at(-1)).toEqual(
			expect.objectContaining({
				ok: false,
				error: expect.objectContaining({ code: "unauthorized" }),
			}),
		);

		pending = collectUntil(protocol.output(), responseFor("controller"));
		await protocol.submit(
			request("controller", "attach_session", {
				sessionId: "session-1",
				role: "controller",
			}),
		);
		await pending;
		pending = collectUntil(protocol.output(), responseFor("pause-controller"));
		await protocol.submit(
			request("pause-controller", "pause_session", { sessionId: "session-1" }),
		);
		records = await pending;
		expect(records.at(-1)).toEqual(expect.objectContaining({ ok: true }));
	});

	test("perform_operator_action records an Operator Observation in Session History", async () => {
		const { protocol, history } = await makeProtocol();
		await history.append({
			type: "operator_actions_declared",
			payload: {
				workKey: "work:1",
				actions: [{ id: "approve", label: "Approve" }],
			},
		});
		let pending = collectUntil(protocol.output(), responseFor("attach"));
		await protocol.submit(
			request("attach", "attach_session", {
				sessionId: "session-1",
				role: "controller",
			}),
		);
		await pending;

		pending = collectUntil(protocol.output(), responseFor("action"));
		await protocol.submit(
			request("action", "perform_operator_action", {
				sessionId: "session-1",
				workKey: "work:1",
				actionId: "approve",
			}),
		);
		const records = await pending;
		const written = (await history.readAll()).events.find(
			(event) => event.type === "operator_observation_recorded",
		);

		expect(records.at(-1)).toEqual(expect.objectContaining({ ok: true }));
		expect(written).toEqual(
			expect.objectContaining({
				type: "operator_observation_recorded",
				payload: expect.objectContaining({
					workKey: "work:1",
					actionId: "approve",
					actionLabel: "Approve",
				}),
			}),
		);
	});
});
