import { PassThrough } from "node:stream";
import { expect, test } from "bun:test";
import type { SessionManagerClient } from "@plot/session-manager/manager";
import type { SessionSummary } from "@plot/session-manager/session";
import { runPlotTui } from "../src/plot-tui.js";
import { ProcessTerminal } from "../src/terminal-ui.js";

const session: SessionSummary = {
	id: "session-1",
	workflowKey: "/repo/WORKFLOW.md",
	workflowName: "review",
	workflowPath: "/repo/WORK FLOW's.md",
	workflowAliases: ["/repo/WORK FLOW's.md"],
	projectPath: "/repo",
	state: "online",
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
	historyPath: "/repo/.plot/sessions/session-1.jsonl",
};

const harness = () => {
	let stops = 0;
	let eventStreamAborted = false;
	const manager: SessionManagerClient = {
		start: async () => ({ session, started: false }),
		find: async () => session,
		get: async () => session,
		stop: async () => session,
		stopSession: async () => {
			stops += 1;
			return { ...session, state: "stopped" };
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
		startSourceAction: async () => ({
			accepted: true,
			actionRunId: "action-1",
		}),
		cancelSourceAction: async () => true,
		observe: async () => true,
	};
	const input = new PassThrough();
	const output = new PassThrough();
	let text = "";
	output.on("data", (chunk) => {
		text += String(chunk);
	});
	const terminal = new ProcessTerminal(
		input as unknown as NodeJS.ReadStream,
		output as unknown as NodeJS.WriteStream,
	);
	return {
		manager,
		input,
		terminal,
		stops: () => stops,
		output: () => text,
		eventStreamAborted: () => eventStreamAborted,
	};
};

test("q and Ctrl-C confirm before stopping the Session", async () => {
	for (const key of ["q", "\u0003"]) {
		const state = harness();
		const running = runPlotTui({
			manager: state.manager,
			session,
			terminal: state.terminal,
		});
		// eslint-disable-next-line no-await-in-loop -- exercise both stop keys independently.
		await Bun.sleep(1);
		state.input.write(key);
		// eslint-disable-next-line no-await-in-loop -- first key must leave the TUI open for confirmation.
		await Bun.sleep(1);

		expect(state.stops()).toBe(0);
		state.input.write(key);
		// eslint-disable-next-line no-await-in-loop -- each TUI must complete before creating the next.
		await running;

		expect(state.stops()).toBe(1);
		expect(state.output()).toContain("Stopped review.");
		expect(state.eventStreamAborted()).toBe(true);
	}
});

test("d explicitly detaches and prints a copyable stop command", async () => {
	const state = harness();
	const running = runPlotTui({
		manager: state.manager,
		session,
		terminal: state.terminal,
	});
	await Bun.sleep(1);
	state.input.write("d");
	await running;

	expect(state.stops()).toBe(0);
	expect(state.output()).toContain(
		"Detached; review is still running and may continue using tokens.",
	);
	expect(state.output()).toContain("plot stop '/repo/WORK FLOW'\\''s.md'");
	expect(state.eventStreamAborted()).toBe(true);
});
