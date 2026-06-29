import { appendFile, mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, test } from "bun:test";
import { EventLogError, createFileEventLogStore } from "../src/event-log.js";

const tempSessionDir = () => mkdtemp(join(tmpdir(), "plot-log-"));

describe("file event log", () => {
	test("serializes concurrent appends with monotonic sequence and frontier", async () => {
		const store = await createFileEventLogStore({
			sessionDir: await tempSessionDir(),
			sessionId: "session-1",
		});

		const [first, second, third] = await Promise.all([
			store.appendSessionEvent({ type: "session_started" }),
			store.appendAgentEvent({
				sourceId: "source",
				runId: "run-1",
				workKey: "work-1",
				event: { type: "message" },
			}),
			store.appendSessionEvent({ type: "session_shutdown" }),
		]);

		expect([first.sequence, second.sequence, third.sequence]).toEqual([
			1, 2, 3,
		]);
		expect((await store.frontier()).lastSequence).toBe(3);
		expect((await store.frontier()).byteOffset).toBeGreaterThan(0);
		expect(
			(await store.readAll()).records.map((record) => record.sequence),
		).toEqual([1, 2, 3]);
		expect(
			(
				await store.readFrom({
					sessionId: "session-1",
					lastSequence: 1,
					byteOffset: 0,
					path: store.path,
				})
			).map((record) => record.sequence),
		).toEqual([2, 3]);
	});

	test("reads previous event-log kind names through the boundary", async () => {
		const store = await createFileEventLogStore({
			sessionDir: await tempSessionDir(),
			sessionId: "session-legacy",
		});
		await mkdir(dirname(store.path), { recursive: true });
		await appendFile(
			store.path,
			`${JSON.stringify({
				kind: "plot_event",
				sessionId: "session-legacy",
				sequence: 1,
				timestamp: "2026-01-01T00:00:00.000Z",
				type: "session_started",
			})}\n${JSON.stringify({
				kind: "agent_session_event",
				sessionId: "session-legacy",
				sequence: 2,
				timestamp: "2026-01-01T00:00:01.000Z",
				type: "agent_session_event",
				sourceId: "source",
				runId: "run",
				workKey: "work",
				event: { type: "message" },
			})}\n`,
			"utf8",
		);

		const records = (await store.readAll()).records;

		expect(records).toEqual([
			expect.objectContaining({ kind: "session_event", sequence: 1 }),
			expect.objectContaining({
				kind: "agent_event",
				sequence: 2,
				event: { type: "message" },
			}),
		]);
	});

	test("ignores corrupt final line but rejects corrupt middle line", async () => {
		const store = await createFileEventLogStore({
			sessionDir: await tempSessionDir(),
			sessionId: "session-1",
		});
		await store.appendSessionEvent({ type: "session_started" });
		await appendFile(store.path, "{ partial", "utf8");

		const tailed = await store.readAll();
		expect(tailed.records).toHaveLength(1);
		expect(tailed.diagnostics[0]?.message).toContain("corrupt final");

		await appendFile(
			store.path,
			`\n${JSON.stringify({
				kind: "session_event",
				sessionId: "session-1",
				sequence: 2,
				timestamp: "2026-01-01T00:00:00.000Z",
				type: "after_corruption",
			})}\n`,
			"utf8",
		);

		await expect(store.readAll()).rejects.toBeInstanceOf(EventLogError);
	});
});
