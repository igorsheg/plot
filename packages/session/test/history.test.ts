import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import {
	createSessionEventLogWriter,
	readSessionEvents,
} from "../src/history.js";
import { createMemorySessionEventStore } from "../src/history-memory.js";
import type { RuntimeEvent } from "../src/runtime.js";

const event = (): RuntimeEvent => ({
	kind: "session_event",
	sessionId: "session-history-test",
	sequence: 1,
	timestamp: "2026-01-01T00:00:00.000Z",
	event: { type: "session_started" },
});

test("session event replay skips structurally invalid records", async () => {
	const dir = await mkdtemp(join(tmpdir(), "history-replay-"));
	const path = join(dir, "events.jsonl");
	await writeFile(
		path,
		`${JSON.stringify({ kind: "session_event" })}\n${JSON.stringify(event())}\n`,
	);
	const events = [];
	for await (const record of readSessionEvents(path)) events.push(record);
	expect(events).toEqual([event()]);
});

test("session history retains every sequenced event", async () => {
	const dir = await mkdtemp(join(tmpdir(), "history-complete-"));
	const path = join(dir, "events.jsonl");
	const agentEvent: RuntimeEvent = {
		kind: "agent_event",
		sessionId: "session-history-test",
		sequence: 1,
		timestamp: "2026-01-01T00:00:00.000Z",
		sourceId: "extension:test",
		runId: "run-1",
		workKey: "work-1",
		event: { type: "text_delta", delta: "hello" },
	};
	const writer = createSessionEventLogWriter(path);
	await writer.append(agentEvent);
	await writer.close();
	const replayed = [];
	for await (const record of readSessionEvents(path)) replayed.push(record);
	expect(replayed).toEqual([agentEvent]);
});

test("session event log writer rejects existing logs", async () => {
	const dir = await mkdtemp(join(tmpdir(), "history-existing-"));
	const path = join(dir, "events.jsonl");
	const first = createSessionEventLogWriter(path);
	await first.append(event());
	await first.close();

	const second = createSessionEventLogWriter(path);
	await expect(second.append(event())).rejects.toMatchObject({
		code: "EEXIST",
	});
});

test("memory event store replays a suffix and closes admission", async () => {
	const store = createMemorySessionEventStore(2);
	const first = event();
	const second = { ...first, sequence: 2 };
	await store.append(first);
	await store.append(second);
	const replayed = [];
	for await (const record of store.read(1)) replayed.push(record);
	expect(replayed).toEqual([second]);
	await store.close();
	await expect(store.append(first)).rejects.toThrow("closed");
});

test("session event log writer rejects durable write failures", async () => {
	const dir = await mkdtemp(join(tmpdir(), "history-"));
	const notDirectory = join(dir, "file");
	await writeFile(notDirectory, "not a directory");
	const writer = createSessionEventLogWriter(
		join(notDirectory, "events.jsonl"),
	);

	await expect(writer.append(event())).rejects.toBeInstanceOf(Error);
});
