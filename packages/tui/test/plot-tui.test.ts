import { PassThrough } from "node:stream";
import { expect, test } from "bun:test";
import type { SessionManagerRuntime } from "@plot/session-manager/manager";
import type { SessionSummary } from "@plot/session-manager/session";
import { runPlotTui } from "../src/plot-tui.js";
import { ProcessTerminal } from "../src/terminal-ui.js";

const session: SessionSummary = {
	id: "session-1",
	workflowKey: "/repo/WORKFLOW.md",
	workflowName: "review",
	workflowPath: "/repo/WORKFLOW.md",
	projectPath: "/repo",
	state: "online",
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
	historyPath: "/repo/.plot/sessions/session-1.jsonl",
	lastSequence: 0,
};

test("quitting the TUI detaches without stopping its Session", async () => {
	let stops = 0;
	let eventStreamAborted = false;
	const manager: SessionManagerRuntime = {
		start: async () => ({ session, started: false }),
		find: async () => session,
		get: async () => session,
		stop: async () => {
			stops += 1;
			return session;
		},
		stopSession: async () => {
			stops += 1;
			return session;
		},
		list: async () => [session],
		events: (_id, _after, signal) => ({
			[Symbol.asyncIterator]() {
				return {
					next: async () => {
						await new Promise<void>((resolve) => {
							if (signal?.aborted) {
								resolve();
								return;
							}
							signal?.addEventListener("abort", () => resolve(), {
								once: true,
							});
						});
						eventStreamAborted = signal?.aborted === true;
						return { value: undefined, done: true } as const;
					},
				};
			},
		}),
		tick: async () => {},
		pause: async () => {},
		resume: async () => {},
		interrupt: async () => true,
		startSourceAction: async () => ({ accepted: true }),
		cancelSourceAction: async () => true,
		observe: async () => true,
		shutdown: async () => {},
	};
	const input = new PassThrough();
	const output = new PassThrough();
	const terminal = new ProcessTerminal(
		input as unknown as NodeJS.ReadStream,
		output as unknown as NodeJS.WriteStream,
	);

	const running = runPlotTui({ manager, session, terminal });
	await Bun.sleep(1);
	input.write("q");
	await running;

	expect(stops).toBe(0);
	expect(eventStreamAborted).toBe(true);
});
