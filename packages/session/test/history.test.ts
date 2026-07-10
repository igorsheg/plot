import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { createSessionEventLogWriter } from "../src/history.js";
import type { RuntimeEvent } from "../src/runtime.js";

const event = (): RuntimeEvent => ({
	kind: "session_event",
	sessionId: "session-history-test",
	sequence: 1,
	timestamp: "2026-01-01T00:00:00.000Z",
	event: { type: "session_started" },
});

test("session event log writer rejects existing logs", async () => {
	const dir = await mkdtemp(join(tmpdir(), "plot-history-existing-"));
	const path = join(dir, "events.jsonl");
	const first = createSessionEventLogWriter(path);
	await first.append(event());
	await first.close();

	const second = createSessionEventLogWriter(path);
	await expect(second.append(event())).rejects.toMatchObject({
		code: "EEXIST",
	});
	await expect(second.close()).rejects.toMatchObject({ code: "EEXIST" });
});

test("session event log writer rejects durable write failures", async () => {
	const dir = await mkdtemp(join(tmpdir(), "plot-history-"));
	const notDirectory = join(dir, "file");
	await writeFile(notDirectory, "not a directory");
	const writer = createSessionEventLogWriter(
		join(notDirectory, "events.jsonl"),
	);

	await expect(writer.append(event())).rejects.toBeInstanceOf(Error);
	await expect(writer.close()).rejects.toBeInstanceOf(Error);
});
