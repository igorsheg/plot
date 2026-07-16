import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { AsyncQueue } from "@plot/common/async-queue";
import { createSessionEventLogWriter } from "@plot/session/history";
import type { RuntimeEvent } from "@plot/session/runtime";
import { sessionEvents } from "../src/events.js";

const event = (sequence: number): RuntimeEvent => ({
	kind: "session_event",
	sessionId: "session-1",
	sequence,
	timestamp: "2026-01-01T00:00:00.000Z",
	event: { type: "tick_started", tickId: sequence },
});

test("Session continuation replays history then follows live without duplicates", async () => {
	const dir = await mkdtemp(join(tmpdir(), "session-events-"));
	const path = join(dir, "session.jsonl");
	const log = createSessionEventLogWriter(path);
	await log.append(event(1));
	await log.append(event(2));
	await log.close();
	const live = new AsyncQueue<RuntimeEvent>(8);
	live.offer(event(2));
	live.offer(event(3));
	live.close();

	const seen: number[] = [];
	for await (const item of sessionEvents({
		historyPath: path,
		live: () => live,
	}))
		seen.push(item.sequence);

	expect(seen).toEqual([1, 2, 3]);
	await rm(dir, { recursive: true, force: true });
});

test("Session continuation catches up durably after live-buffer overflow", async () => {
	const dir = await mkdtemp(join(tmpdir(), "session-events-overflow-"));
	const path = join(dir, "session.jsonl");
	const log = createSessionEventLogWriter(path);
	for (let sequence = 1; sequence <= 400; sequence++)
		await log.append(event(sequence));
	await log.close();
	let subscriptions = 0;
	const live = () => {
		const queue = new AsyncQueue<RuntimeEvent>(512);
		if (subscriptions++ === 0)
			for (let sequence = 1; sequence <= 400; sequence++)
				queue.offer(event(sequence));
		queue.close();
		return queue;
	};
	const seen: number[] = [];
	for await (const item of sessionEvents({ historyPath: path, live }))
		seen.push(item.sequence);
	expect(seen).toEqual(Array.from({ length: 400 }, (_, index) => index + 1));
	expect(subscriptions).toBe(2);
	await rm(dir, { recursive: true, force: true });
});
