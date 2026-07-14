import { expect, test } from "bun:test";
import type { SessionSummary } from "@plot/session-manager/session";
import {
	activeSessions,
	pastSessions,
	selectedSessionFrom,
} from "../src/app/sessions-store.js";
import { shouldAcceptProjectionBaseline } from "../src/app/projection-store.js";
import { reduceSerializedProjection } from "../src/data/projection-client.js";
import { sessionEventsUrl, sessionProjectionUrl } from "../src/data/routes.js";
import { projectionEventFromSse } from "../src/data/sse.js";
import {
	eventSourceMessages,
	type EventSourceLike,
} from "../src/data/sse-client.js";
import {
	emptyProjection,
	serializeDashboardProjection,
} from "@plot/projection";

const session = (
	id: string,
	state: SessionSummary["state"],
	extra: Partial<SessionSummary> = {},
): SessionSummary => ({
	id,
	workflowKey: `/tmp/${id}/WORKFLOW.md`,
	workflowName: id,
	workflowPath: `/tmp/${id}/WORKFLOW.md`,
	workflowAliases: [`/tmp/${id}/WORKFLOW.md`],
	projectPath: `/tmp/${id}`,
	state,
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
	historyPath: `/tmp/${id}/.plot/sessions/${id}.jsonl`,
	lastSequence: 0,
	...extra,
});

class FakeEventSource implements EventSourceLike {
	closed = false;
	private readonly listeners = new Map<string, Set<(event: Event) => void>>();

	addEventListener(type: string, listener: (event: Event) => void): void {
		const listeners = this.listeners.get(type) ?? new Set();
		listeners.add(listener);
		this.listeners.set(type, listeners);
	}

	removeEventListener(type: string, listener: (event: Event) => void): void {
		this.listeners.get(type)?.delete(listener);
	}

	close(): void {
		this.closed = true;
	}

	emit(type: string, data: string): void {
		for (const listener of this.listeners.get(type) ?? [])
			listener({ data } as MessageEvent);
	}
}

test("session dock keeps only active runs", () => {
	expect(
		activeSessions([
			session("one", "online"),
			session("two", "stopped"),
			session("three", "error"),
		]).map((entry) => entry.id),
	).toEqual(["one"]);
});

test("selected run falls back to the first active session", () => {
	const runs = [session("one", "online"), session("two", "online")];
	const active = activeSessions(runs);
	expect(selectedSessionFrom(runs, active, "two")?.id).toBe("two");
	expect(selectedSessionFrom(runs, active, "missing")?.id).toBe("one");
});

test("a stopped run stays selectable by id across all runs", () => {
	const runs = [session("live", "online"), session("gone", "stopped")];
	const active = activeSessions(runs);
	expect(selectedSessionFrom(runs, active, "gone")?.id).toBe("gone");
	expect(selectedSessionFrom(runs, active, undefined)?.id).toBe("live");
});

test("past runs keep stopped sessions, most-recently-seen first", () => {
	const runs = [
		session("live", "online"),
		session("old", "stopped", { updatedAt: "2026-01-01T00:00:00.000Z" }),
		session("recent", "stopped", { updatedAt: "2026-01-02T00:00:00.000Z" }),
		session("errored", "error", {
			updatedAt: "2026-01-03T00:00:00.000Z",
		}),
	];
	expect(pastSessions(runs).map((entry) => entry.id)).toEqual([
		"errored",
		"recent",
		"old",
	]);
});

test("projection fetch key is stable and event stream resumes after a projection frontier", () => {
	const selected = { ...session("one/two", "online"), lastSequence: 7 };
	expect(sessionProjectionUrl(selected)).toBe(
		"/api/sessions/one%2Ftwo/projection",
	);
	expect(sessionEventsUrl(selected)).toBe(
		"/api/sessions/one%2Ftwo/events?after=7",
	);
	expect(sessionEventsUrl(selected, 11)).toBe(
		"/api/sessions/one%2Ftwo/events?after=11",
	);
});

test("SSE helper parses selected-run protocol events", () => {
	expect(
		projectionEventFromSse(
			JSON.stringify({
				kind: "event",
				event: {
					kind: "session_event",
					sessionId: "s",
					sequence: 2,
					timestamp: "2026-01-01T00:00:00.000Z",
					event: { type: "session_shutdown" },
				},
			}),
		)?.sequence,
	).toBe(2);
});

test("projection reducer ignores duplicate or stale stream events", () => {
	const projection = serializeDashboardProjection({
		...emptyProjection("session-1", "workflow"),
		frontier: 4,
	});
	const next = reduceSerializedProjection(projection, {
		kind: "session_event",
		sessionId: "session-1",
		sequence: 4,
		timestamp: "2026-01-01T00:00:00.000Z",
		event: { type: "session_shutdown" },
	});
	expect(next).toBe(projection);
});

test("projection baseline sync ignores stale snapshots behind live SSE", () => {
	const current = serializeDashboardProjection({
		...emptyProjection("session-1", "workflow"),
		frontier: 10,
	});
	const stale = { ...current, frontier: 8 };
	const same = { ...current, frontier: 10 };
	const newer = { ...current, frontier: 11 };
	const otherSession = { ...stale, sessionId: "session-2" };

	expect(shouldAcceptProjectionBaseline({ current, baseline: stale })).toBe(
		false,
	);
	expect(shouldAcceptProjectionBaseline({ current, baseline: same })).toBe(
		true,
	);
	expect(shouldAcceptProjectionBaseline({ current, baseline: newer })).toBe(
		true,
	);
	expect(
		shouldAcceptProjectionBaseline({ current, baseline: otherSession }),
	).toBe(true);
});

test("SSE client exposes EventSource messages as an abortable async iterable", async () => {
	let source: FakeEventSource | undefined;
	const controller = new AbortController();
	const iterator = eventSourceMessages("/stream", {
		eventName: "plot",
		signal: controller.signal,
		createEventSource: (url) => {
			expect(url).toBe("/stream");
			source = new FakeEventSource();
			return source;
		},
	})[Symbol.asyncIterator]();

	const next = iterator.next();
	source?.emit("plot", "payload");
	const result = await next;
	expect(result.done).toBe(false);
	expect(result.value?.data).toBe("payload");

	const closed = iterator.next();
	controller.abort();
	expect((await closed).done).toBe(true);
	expect(source?.closed).toBe(true);
});
