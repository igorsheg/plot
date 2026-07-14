import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import type { SessionSummary } from "../src/session.js";
import {
	createFileSessionStore,
	createMemorySessionStore,
	type SessionStore,
} from "../src/session-store.js";

const summary = (
	id: string,
	state: SessionSummary["state"] = "online",
): SessionSummary => ({
	id,
	workflowKey: `/repo/${id}/WORKFLOW.md`,
	workflowName: id,
	workflowPath: `/repo/${id}/WORKFLOW.md`,
	workflowAliases: [`/linked/${id}/WORKFLOW.md`],
	projectPath: `/repo/${id}`,
	state,
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
	historyPath: `/repo/${id}/session.jsonl`,
	lastSequence: 0,
});

const defineStoreContract = (
	name: string,
	create: () => Promise<{
		readonly store: SessionStore;
		readonly cleanup: () => Promise<void>;
	}>,
) => {
	describe(`${name} Session Store contract`, () => {
		test("upserts summaries and round-trips Workflow aliases", async () => {
			const harness = await create();
			try {
				expect(await harness.store.list()).toEqual([]);
				const initial = summary("session-1");
				await harness.store.upsert(initial);
				expect(await harness.store.get(initial.id)).toEqual(initial);
				const updated = {
					...initial,
					workflowAliases: [...initial.workflowAliases, "/another/WORKFLOW.md"],
					lastSequence: 7,
				};
				await harness.store.upsert(updated);
				expect(await harness.store.list()).toEqual([updated]);
			} finally {
				await harness.cleanup();
			}
		});

		test("serializes concurrent upserts", async () => {
			const harness = await create();
			try {
				await Promise.all(
					Array.from({ length: 20 }, (_, index) =>
						harness.store.upsert(summary(`session-${index}`)),
					),
				);
				expect(await harness.store.list()).toHaveLength(20);
			} finally {
				await harness.cleanup();
			}
		});

		test("restart recovery errors only active Sessions", async () => {
			const harness = await create();
			try {
				for (const item of [
					summary("starting", "starting"),
					summary("online", "online"),
					summary("stopping", "stopping"),
					summary("stopped", "stopped"),
					summary("error", "error"),
				])
					// eslint-disable-next-line no-await-in-loop -- setup preserves intentional order.
					await harness.store.upsert(item);
				await harness.store.recoverAfterRestart();
				const states = new Map(
					(await harness.store.list()).map((item) => [item.id, item.state]),
				);
				expect(states).toEqual(
					new Map([
						["starting", "error"],
						["online", "error"],
						["stopping", "error"],
						["stopped", "stopped"],
						["error", "error"],
					]),
				);
			} finally {
				await harness.cleanup();
			}
		});
	});
};

defineStoreContract("memory", async () => ({
	store: createMemorySessionStore(),
	cleanup: async () => {},
}));

defineStoreContract("file", async () => {
	const dir = await mkdtemp(join(tmpdir(), "plot-session-store-"));
	return {
		store: createFileSessionStore(join(dir, "sessions.json")),
		cleanup: () => rm(dir, { recursive: true, force: true }),
	};
});

test("file store recovers complete summaries from a truncated final write", async () => {
	const dir = await mkdtemp(join(tmpdir(), "plot-session-store-truncated-"));
	const path = join(dir, "sessions.json");
	try {
		const first = summary("first");
		const second = summary("second");
		const text = `${JSON.stringify([first, second], null, 2)}\n`;
		await writeFile(path, text.slice(0, text.lastIndexOf("\n  }")));
		const store = createFileSessionStore(path);
		expect(await store.list()).toEqual([first]);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("file store rejects content with no complete summary", async () => {
	const dir = await mkdtemp(join(tmpdir(), "plot-session-store-invalid-"));
	const path = join(dir, "sessions.json");
	try {
		await writeFile(path, '[{"id":"broken"');
		await expect(createFileSessionStore(path).list()).rejects.toBeDefined();
		expect(await readFile(path, "utf8")).toBe('[{"id":"broken"');
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
