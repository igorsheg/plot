import { expect, test } from "bun:test";
import type { RunRecord } from "@plot/registry/record";
import {
	activeRuns,
	pastRuns,
	selectedRunFrom,
} from "../src/app/runs-store.js";
import { reduceSerializedProjection } from "../src/data/projection-client.js";
import { runEventsUrl, runProjectionUrl } from "../src/data/routes.js";
import { projectionEventFromSse } from "../src/data/sse.js";
import {
	eventSourceMessages,
	type EventSourceLike,
} from "../src/data/sse-client.js";
import {
	emptyProjection,
	serializeDashboardProjection,
} from "@plot/projection";

const run = (
	id: string,
	status: RunRecord["status"],
	extra: Partial<RunRecord> = {},
): RunRecord => ({
	id,
	status,
	cwd: `/tmp/${id}`,
	createdAt: "2026-01-01T00:00:00.000Z",
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
		activeRuns([
			run("one", "online"),
			run("two", "stopped"),
			run("three", "error"),
		]).map((entry) => entry.id),
	).toEqual(["one"]);
});

test("selected run falls back to the first active session", () => {
	const runs = [run("one", "online"), run("two", "online")];
	const active = activeRuns(runs);
	expect(selectedRunFrom(runs, active, "two")?.id).toBe("two");
	expect(selectedRunFrom(runs, active, "missing")?.id).toBe("one");
});

test("a stopped run stays selectable by id across all runs", () => {
	const runs = [run("live", "online"), run("gone", "stopped")];
	const active = activeRuns(runs);
	expect(selectedRunFrom(runs, active, "gone")?.id).toBe("gone");
	expect(selectedRunFrom(runs, active, undefined)?.id).toBe("live");
});

test("past runs keep stopped sessions, most-recently-seen first", () => {
	const runs = [
		run("live", "online"),
		run("old", "stopped", { lastSeenAt: "2026-01-01T00:00:00.000Z" }),
		run("recent", "stopped", { lastSeenAt: "2026-01-02T00:00:00.000Z" }),
		run("errored", "error"),
	];
	expect(pastRuns(runs).map((entry) => entry.id)).toEqual(["recent", "old"]);
});

test("projection fetch key is stable and event stream resumes after a projection frontier", () => {
	const selected = { ...run("one/two", "online"), lastSequence: 7 };
	expect(runProjectionUrl(selected)).toBe("/api/runs/one%2Ftwo/projection");
	expect(runEventsUrl(selected)).toBe("/api/runs/one%2Ftwo/events?after=7");
	expect(runEventsUrl(selected, 11)).toBe(
		"/api/runs/one%2Ftwo/events?after=11",
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
