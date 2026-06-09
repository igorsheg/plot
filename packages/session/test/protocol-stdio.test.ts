import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import type { WorkRunner } from "@plot/agent/work-runner";
import { makePlotSessionLayer } from "../src/plot-session.js";
import { decodePlotServerRecord } from "../src/protocol.js";
import { makePlotProtocolLayer } from "../src/protocol-handler.js";
import { runPlotProtocolStdio } from "../src/protocol-stdio.js";
import type { WorkflowDefinition } from "../src/workflow.js";

const workflow: WorkflowDefinition = {
	config: {},
	prompt: "Do useful work.",
};

const runner: WorkRunner = {
	run: () => Effect.succeed({}),
};

const layer = makePlotProtocolLayer().pipe(
	Layer.provide(makePlotSessionLayer({ workflow, sources: [], runner })),
);

async function* chunks(values: readonly string[]) {
	for (const value of values) yield value;
}

const decodeLines = (lines: readonly string[]) =>
	Effect.all(
		lines.map((line) => decodePlotServerRecord(JSON.parse(line) as unknown)),
	);

describe("plot protocol stdio transport", () => {
	test("emits hello and routes stdin requests to stdout protocol records", async () => {
		const stdout: string[] = [];
		await Effect.runPromise(
			runPlotProtocolStdio({
				stdin: chunks([
					'{"protocol":"plot.v1","kind":"request","id":"req-1","command":"ping"}\n',
				]),
				writeStdout: (line) => Effect.sync(() => stdout.push(line)),
			}).pipe(Effect.provide(layer)),
		);
		const records = await Effect.runPromise(decodeLines(stdout));

		expect(records.map((record) => record.kind)).toEqual(["hello", "response"]);
		expect(records[1]).toEqual(
			expect.objectContaining({
				kind: "response",
				id: "req-1",
				command: "ping",
				ok: true,
			}),
		);
	});

	test("keeps stdout protocol-clean for parse and schema errors", async () => {
		const stdout: string[] = [];
		await Effect.runPromise(
			runPlotProtocolStdio({
				stdin: chunks([
					'not-json\n{"protocol":"plot.v1","kind":"request","id":"req-2","command":"prompt"}\n',
				]),
				writeStdout: (line) => Effect.sync(() => stdout.push(line)),
			}).pipe(Effect.provide(layer)),
		);
		const records = await Effect.runPromise(decodeLines(stdout));

		expect(records.every((record) => record.protocol === "plot.v1")).toBe(true);
		expect(records.map((record) => record.kind)).toEqual([
			"hello",
			"response",
			"response",
		]);
		expect(records[1]).toEqual(
			expect.objectContaining({
				kind: "response",
				ok: false,
				error: expect.objectContaining({ code: "parse_error" }),
			}),
		);
		expect(records[2]).toEqual(
			expect.objectContaining({
				kind: "response",
				ok: false,
				error: expect.objectContaining({ code: "invalid_request" }),
			}),
		);
	});
});
