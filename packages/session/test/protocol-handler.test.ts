import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { sourceId, workKey } from "@plot/agent/model";
import type { WorkRunner } from "@plot/agent/work-runner";
import type { WorkSource } from "@plot/agent/work-source";
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

const makeProtocol = async (
	sessionId = "session-1",
	overrides: {
		readonly sources?: readonly WorkSource[];
		readonly runner?: WorkRunner;
	} = {},
) => {
	const sessionDir = await mkdtemp(join(tmpdir(), "plot-protocol-"));
	const history = await createSessionHistoryStore({ sessionDir, sessionId });
	const session = makePlotSessionLayer({
		id: sessionId,
		workflow,
		sources: overrides.sources ?? [],
		runner: overrides.runner ?? runner,
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

	test("perform_operator_action records an Operator Observation for the next reconciliation without calling Source directly", async () => {
		let reconcileCalls = 0;
		const source: WorkSource = {
			id: sourceId("source-1"),
			selectWork: () => [
				{
					workKey: workKey("work:1"),
					display: { title: "Needs decision", version: "v1" },
					operatorActions: [{ id: "approve", label: "Approve" }],
				},
			],
			reconcile: ({ snapshot }) => {
				reconcileCalls++;
				if (snapshot.observations.length > 0)
					expect(snapshot.observations).toContainEqual(
						expect.objectContaining({ type: "operator_observation" }),
					);
				return [];
			},
		};
		const { protocol, history, session } = await makeProtocol("session-1", {
			sources: [source],
			runner: { run: () => new Promise(() => undefined) },
		});
		await session.tickOnce();
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
		const beforeTickCalls = reconcileCalls;
		await session.tickOnce();
		const written = (await history.readAll()).events.find(
			(event) => event.type === "operator_observation_recorded",
		);

		expect(records.at(-1)).toEqual(expect.objectContaining({ ok: true }));
		expect(beforeTickCalls).toBe(1);
		expect(reconcileCalls).toBe(2);
		expect(written).toEqual(
			expect.objectContaining({
				type: "operator_observation_recorded",
				payload: expect.objectContaining({
					sourceId: "source-1",
					workKey: "work:1",
					actionId: "approve",
					actionLabel: "Approve",
					workVersion: "v1",
				}),
			}),
		);
	});

	test("pause blocks future dispatch without interrupting active runs and request_tick is rejected while paused", async () => {
		const source: WorkSource = {
			id: sourceId("source-1"),
			selectWork: () => [{ workKey: workKey("work:1") }],
		};
		const { protocol, session, history } = await makeProtocol("session-1", {
			sources: [source],
			runner: { run: () => new Promise(() => undefined) },
		});
		await session.tickOnce();
		let pending = collectUntil(protocol.output(), responseFor("attach"));
		await protocol.submit(
			request("attach", "attach_session", {
				sessionId: "session-1",
				role: "controller",
			}),
		);
		await pending;

		pending = collectUntil(protocol.output(), responseFor("pause"));
		await protocol.submit(
			request("pause", "pause_session", { sessionId: "session-1" }),
		);
		await pending;
		expect((await session.snapshot()).running.size).toBe(1);

		pending = collectUntil(protocol.output(), responseFor("tick-paused"));
		await protocol.submit(
			request("tick-paused", "request_tick", { sessionId: "session-1" }),
		);
		const records = await pending;
		expect(records.at(-1)).toEqual(
			expect.objectContaining({
				ok: false,
				error: expect.objectContaining({ code: "session_paused" }),
			}),
		);
		expect((await history.readAll()).events).toContainEqual(
			expect.objectContaining({ type: "tick_rejected" }),
		);
	});

	test("interrupt_agent_run targets runId and rejects stale workKey assertions", async () => {
		let selected = false;
		const source: WorkSource = {
			id: sourceId("source-1"),
			selectWork: () => {
				if (selected) return [];
				selected = true;
				return [{ workKey: workKey("work:1") }];
			},
		};
		const { protocol, session, history } = await makeProtocol("session-1", {
			sources: [source],
			runner: { run: () => new Promise(() => undefined) },
		});
		await session.tickOnce();
		let pending = collectUntil(protocol.output(), responseFor("attach"));
		await protocol.submit(
			request("attach", "attach_session", {
				sessionId: "session-1",
				role: "controller",
			}),
		);
		await pending;

		pending = collectUntil(protocol.output(), responseFor("stale"));
		await protocol.submit(
			request("stale", "interrupt_agent_run", {
				sessionId: "session-1",
				runId: "run-0",
				workKey: "work:stale",
			}),
		);
		let records = await pending;
		expect(records.at(-1)).toEqual(
			expect.objectContaining({
				ok: false,
				error: expect.objectContaining({ code: "run_not_found" }),
			}),
		);

		pending = collectUntil(protocol.output(), responseFor("interrupt"));
		await protocol.submit(
			request("interrupt", "interrupt_agent_run", {
				sessionId: "session-1",
				runId: "run-0",
				workKey: "work:1",
			}),
		);
		records = await pending;
		expect(records.at(-1)).toEqual(expect.objectContaining({ ok: true }));
		const types = (await history.readAll()).events.map((event) => event.type);
		expect(types).toContain("agent_run_interrupt_requested");
		expect(types).toContain("agent_run_interrupt_completed");
		expect((await session.snapshot()).running.size).toBe(0);
	});

	test("close_session interrupts active runs and preserves Session History", async () => {
		const source: WorkSource = {
			id: sourceId("source-1"),
			selectWork: () => [{ workKey: workKey("work:1") }],
		};
		const { protocol, session, history } = await makeProtocol("session-1", {
			sources: [source],
			runner: { run: () => new Promise(() => undefined) },
		});
		await session.tickOnce();
		let pending = collectUntil(protocol.output(), responseFor("attach"));
		await protocol.submit(
			request("attach", "attach_session", {
				sessionId: "session-1",
				role: "controller",
			}),
		);
		await pending;

		pending = collectUntil(protocol.output(), responseFor("close"));
		await protocol.submit(
			request("close", "close_session", { sessionId: "session-1" }),
		);
		const records = await pending;
		expect(records.at(-1)).toEqual(expect.objectContaining({ ok: true }));
		expect((await session.snapshot()).running.size).toBe(0);
		const events = (await history.readAll()).events;
		expect(events.length).toBeGreaterThan(0);
		expect(events.map((event) => event.type)).toEqual(
			expect.arrayContaining([
				"session_close_requested",
				"work_completed",
				"session_shutdown",
				"session_close_completed",
			]),
		);
	});

	test("perform_operator_action rejects undeclared disabled and comment-required actions", async () => {
		const source: WorkSource = {
			id: sourceId("source-1"),
			selectWork: () => [
				{
					workKey: workKey("work:1"),
					operatorActions: [
						{ id: "hold", label: "Hold", disabledReason: "not ready" },
						{ id: "comment", label: "Comment", requiresComment: true },
					],
				},
			],
		};
		const { protocol, session } = await makeProtocol("session-1", {
			sources: [source],
			runner: { run: () => new Promise(() => undefined) },
		});
		await session.tickOnce();
		let pending = collectUntil(protocol.output(), responseFor("attach"));
		await protocol.submit(
			request("attach", "attach_session", {
				sessionId: "session-1",
				role: "controller",
			}),
		);
		await pending;

		for (const [id, actionId] of [
			["missing", "missing"],
			["disabled", "hold"],
			["comment", "comment"],
		] as const) {
			pending = collectUntil(protocol.output(), responseFor(id));
			await protocol.submit(
				request(id, "perform_operator_action", {
					sessionId: "session-1",
					workKey: "work:1",
					actionId,
				}),
			);
			const records = await pending;
			expect(records.at(-1)).toEqual(
				expect.objectContaining({
					ok: false,
					error: expect.objectContaining({ code: "invalid_operator_action" }),
				}),
			);
		}
	});
});
