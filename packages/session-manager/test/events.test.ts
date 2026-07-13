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
	const dir = await mkdtemp(join(tmpdir(), "plot-events-"));
	const path = join(dir, "session.jsonl");
	const log = createSessionEventLogWriter(path);
	await log.append(event(1));
	await log.append(event(2));
	await log.close();
	const live = new AsyncQueue<RuntimeEvent>();
	live.offer(event(2));
	live.offer(event(3));
	live.close();

	const seen: number[] = [];
	for await (const item of sessionEvents({ historyPath: path, live }))
		seen.push(item.sequence);

	expect(seen).toEqual([1, 2, 3]);
	await rm(dir, { recursive: true, force: true });
});
