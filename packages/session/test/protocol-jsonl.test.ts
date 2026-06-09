import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { positiveInt } from "@plot/agent/model";
import {
	PlotEventRecord,
	decodePlotServerRecord,
	defaultPlotProtocolLimits,
	makePlotSuccessResponse,
	plotProtocolEpoch,
	plotProtocolRequestId,
	plotProtocolSequence,
} from "../src/protocol.js";
import {
	plotSessionEventSequence,
	plotSessionId,
} from "../src/plot-session.js";
import {
	flushJsonlDecoder,
	initialJsonlDecoderState,
	parsePlotClientJsonLine,
	serializeJsonLine,
	serializePlotServerJsonLine,
	splitJsonlChunk,
} from "../src/protocol-jsonl.js";

describe("plot protocol JSONL framing", () => {
	test("serializes server records as one JSON line", () => {
		const line = serializeJsonLine(
			makePlotSuccessResponse({
				id: plotProtocolRequestId("req-1"),
				command: "ping",
				lastEventSeq: plotProtocolSequence(0),
			}),
		);

		expect(line.endsWith("\n")).toBe(true);
		expect(JSON.parse(line)).toMatchObject({
			protocol: "plot.v1",
			kind: "response",
			id: "req-1",
			command: "ping",
			ok: true,
		});
	});

	test("serializes map-shaped event payloads into JSON-safe arrays", async () => {
		const line = serializeJsonLine(
			new PlotEventRecord({
				protocol: "plot.v1",
				kind: "event",
				sessionId: plotSessionId("default"),
				epoch: plotProtocolEpoch("default"),
				sequence: plotSessionEventSequence(1),
				event: {
					type: "plot_agent_event",
					event: {
						type: "tick_completed",
						result: { snapshot: { facts: new Map([["a", 1]]) } },
					},
				},
			}),
		);
		const parsed = JSON.parse(line) as {
			event: { event: { result: { snapshot: { facts: unknown } } } };
		};

		expect(parsed.event.event.result.snapshot.facts).toEqual([["a", 1]]);
		await Effect.runPromise(decodePlotServerRecord(parsed));
	});

	test("enforces output record limits", async () => {
		const failure = await Effect.runPromise(
			Effect.flip(
				serializePlotServerJsonLine(
					makePlotSuccessResponse({
						id: plotProtocolRequestId("req-1"),
						command: "ping",
						lastEventSeq: plotProtocolSequence(0),
					}),
					{
						...defaultPlotProtocolLimits,
						maxOutputRecordBytes: positiveInt(2),
					},
				),
			),
		);

		expect(failure.code).toBe("payload_too_large");
		expect(failure.message).toContain("maxOutputRecordBytes");
	});

	test("splits LF JSONL chunks and strips trailing carriage returns", async () => {
		const first = await Effect.runPromise(
			splitJsonlChunk(
				initialJsonlDecoderState,
				'{"protocol":"plot.v1","kind":"request","id":"r1","command":"ping"}\r\n{"protocol"',
			),
		);
		const second = await Effect.runPromise(
			splitJsonlChunk(
				first.state,
				':"plot.v1","kind":"request","id":"r2","command":"shutdown"}\n',
			),
		);

		expect(first.lines).toEqual([
			'{"protocol":"plot.v1","kind":"request","id":"r1","command":"ping"}',
		]);
		expect(second.lines).toEqual([
			'{"protocol":"plot.v1","kind":"request","id":"r2","command":"shutdown"}',
		]);
		expect(second.state.pending).toBe("");
	});

	test("flushes final unterminated line", async () => {
		const split = await Effect.runPromise(
			splitJsonlChunk(
				initialJsonlDecoderState,
				'{"protocol":"plot.v1","kind":"request","id":"r1","command":"ping"}',
			),
		);
		const lines = await Effect.runPromise(flushJsonlDecoder(split.state));

		expect(split.lines).toEqual([]);
		expect(lines).toEqual([
			'{"protocol":"plot.v1","kind":"request","id":"r1","command":"ping"}',
		]);
	});

	test("parses and validates client JSON lines", async () => {
		const request = await Effect.runPromise(
			parsePlotClientJsonLine(
				'{"protocol":"plot.v1","kind":"request","id":"r1","command":"subscribe","params":{"afterSequence":3}}',
			),
		);

		expect(request.command).toBe("subscribe");
		expect(request.params).toEqual({ afterSequence: 3 });
	});

	test("reports parse errors distinctly from schema errors", async () => {
		const parseFailure = await Effect.runPromise(
			Effect.flip(parsePlotClientJsonLine("not-json")),
		);
		const schemaFailure = await Effect.runPromise(
			Effect.flip(
				parsePlotClientJsonLine(
					'{"protocol":"plot.v1","kind":"request","id":"r1","command":"prompt"}',
				),
			),
		);

		expect(parseFailure.code).toBe("parse_error");
		expect(schemaFailure.code).toBe("invalid_request");
	});
});
