import { expect, test } from "bun:test";
import type { SessionManagerClient } from "@plot/session-manager/manager";
import type { SessionSummary } from "@plot/session-manager/session";
import type { RuntimeEvent } from "@plot/session/runtime";
import { startWebGateway } from "../src/gateway.js";

const session: SessionSummary = {
	id: "session-1",
	workflowKey: "/repo/WORKFLOW.md",
	workflowName: "review-acme",
	workflowPath: "/repo/WORKFLOW.md",
	workflowAliases: ["/repo/WORKFLOW.md"],
	projectPath: "/repo",
	state: "online",
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
	historyPath: "/repo/.plot/sessions/session-1.jsonl",
};

const fakeManager = () => {
	const shutdowns = 0;
	let stops = 0;
	const sourceActions: unknown[] = [];
	const eventRequests: { sessionId: string; after: number }[] = [];
	const events: RuntimeEvent[] = [];
	const manager: SessionManagerClient = {
		start: async () => ({ session, started: false }),
		find: async () => session,
		get: async (id) => (id === session.id ? session : undefined),
		stop: async () => session,
		stopSession: async (id) => {
			if (id !== session.id) return;
			stops += 1;
			return { ...session, state: "stopped" };
		},
		list: async () => [session],
		events: async function* (sessionId, after = 0) {
			eventRequests.push({ sessionId, after });
			yield* events;
		},
		tick: async () => {},
		startSourceAction: async (_sessionId, input) => {
			sourceActions.push(input);
			return { accepted: true, actionRunId: "action-1" };
		},
		cancelSourceAction: async () => true,
		observe: async () => true,
	};
	return {
		manager,
		shutdowns: () => shutdowns,
		stops: () => stops,
		sourceActions,
		eventRequests,
		events,
	};
};

test("Web Console lists and explicitly stops Sessions", async () => {
	const fake = fakeManager();
	const gateway = await startWebGateway({ manager: fake.manager });
	try {
		const listed = await fetch(new URL("/api/sessions", gateway.url));
		expect(listed.status).toBe(200);
		expect(await listed.json()).toEqual({ sessions: [session] });
		expect(
			await fetch(new URL("/api/sessions", gateway.url), { method: "PUT" }),
		).toMatchObject({ status: 404 });

		const stopped = await fetch(
			new URL(`/api/sessions/${session.id}`, gateway.url),
			{ method: "DELETE" },
		);
		expect(stopped.status).toBe(200);
		expect(fake.stops()).toBe(1);

		const action = await fetch(
			new URL(`/api/sessions/${session.id}/source-actions`, gateway.url),
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					sourceId: "extension:jira",
					requirementId: "auth",
					actionId: "connect",
				}),
			},
		);
		expect(action.status).toBe(200);
		expect(await action.json()).toEqual({
			accepted: true,
			actionRunId: "action-1",
		});
		expect(fake.sourceActions).toEqual([
			{
				sourceId: "extension:jira",
				requirementId: "auth",
				actionId: "connect",
			},
		]);
	} finally {
		gateway.stop();
	}
});

test("SSE pulls ordered Session events from the requested frontier", async () => {
	const fake = fakeManager();
	fake.events.push({
		kind: "session_event",
		sessionId: session.id,
		sequence: 5,
		timestamp: "2026-01-01T00:00:00.000Z",
		event: { type: "tick_started", tickId: 1 },
	});
	const gateway = await startWebGateway({ manager: fake.manager });
	try {
		const response = await fetch(
			new URL(`/api/sessions/${session.id}/events?after=4`, gateway.url),
			{ headers: { "last-event-id": "3" } },
		);
		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body).toStartWith(": connected\n\n");
		expect(body).toContain("id: 5\nevent: plot\n");
		expect(fake.eventRequests).toEqual([{ sessionId: session.id, after: 4 }]);
	} finally {
		gateway.stop();
	}
});

test("stopping the Web Console does not stop managed Sessions", async () => {
	const fake = fakeManager();
	const gateway = await startWebGateway({ manager: fake.manager });

	gateway.stop();

	expect(fake.shutdowns()).toBe(0);
	expect(fake.stops()).toBe(0);
});
