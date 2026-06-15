import { describe, expect, test } from "bun:test";
import { positiveInt } from "@plot/agent/model";
import type { SessionHistoryEvent } from "@plot/control/session-history";
import {
	PlotSessionEventRecord,
	decodePlotServerRecord,
	defaultPlotProtocolLimits,
	makePlotSuccessResponse,
	plotProtocolEpoch,
	plotProtocolRequestId,
	plotProtocolVersion,
} from "../src/protocol.js";
import {
	flushJsonlDecoder,
	initialJsonlDecoderState,
	parsePlotClientJsonLine,
	serializeJsonLine,
	serializePlotServerJsonLine,
	splitJsonlChunk,
} from "../src/protocol-jsonl.js";

const event: SessionHistoryEvent = {
	sessionId: "session-1",
	epoch: "epoch-1",
	sequence: 1,
	timestamp: "2026-06-15T00:00:00.000Z",
	type: "tick_completed",
	payload: { result: { snapshot: { facts: new Map([["a", 1]]) } } },
};

describe("plot control protocol JSONL framing", () => {
	test("serializes server records as one JSON line", () => {
		const line = serializeJsonLine(
			makePlotSuccessResponse({
				id: plotProtocolRequestId("req-1"),
				command: "ping",
			}),
		);

		expect(line.endsWith("\n")).toBe(true);
		expect(JSON.parse(line)).toMatchObject({
			protocol: plotProtocolVersion,
			kind: "response",
			id: "req-1",
			command: "ping",
			ok: true,
		});
	});

	test("serializes map-shaped event payloads into JSON-safe arrays", async () => {
		const line = serializeJsonLine(
			new PlotSessionEventRecord({
				sessionId: "session-1",
				epoch: plotProtocolEpoch("epoch-1"),
				sequence: 1,
				event,
			}),
		);
		const parsed = JSON.parse(line) as {
			event: { payload: { result: { snapshot: { facts: unknown } } } };
		};

		expect(parsed.event.payload.result.snapshot.facts).toEqual([["a", 1]]);
		await decodePlotServerRecord(parsed);
	});

	test("enforces output record limits", async () => {
		try {
			await serializePlotServerJsonLine(
				makePlotSuccessResponse({
					id: plotProtocolRequestId("req-1"),
					command: "ping",
				}),
				{
					...defaultPlotProtocolLimits,
					maxOutputRecordBytes: positiveInt(2),
				},
			);
			throw new Error("expected failure");
		} catch (failure) {
			expect((failure as { code: string }).code).toBe("payload_too_large");
			expect((failure as Error).message).toContain("maxOutputRecordBytes");
		}
	});

	test("splits LF JSONL chunks and strips trailing carriage returns", async () => {
		const first = await splitJsonlChunk(
			initialJsonlDecoderState,
			`{"protocol":"${plotProtocolVersion}","kind":"request","id":"r1","command":"ping"}\r\n{"protocol"`,
		);
		const second = await splitJsonlChunk(
			first.state,
			`:"${plotProtocolVersion}","kind":"request","id":"r2","command":"list_sessions"}\n`,
		);

		expect(first.lines).toEqual([
			`{"protocol":"${plotProtocolVersion}","kind":"request","id":"r1","command":"ping"}`,
		]);
		expect(second.lines).toEqual([
			`{"protocol":"${plotProtocolVersion}","kind":"request","id":"r2","command":"list_sessions"}`,
		]);
		expect(second.state.pending).toBe("");
	});

	test("flushes final unterminated line", async () => {
		const split = await splitJsonlChunk(
			initialJsonlDecoderState,
			`{"protocol":"${plotProtocolVersion}","kind":"request","id":"r1","command":"ping"}`,
		);
		const lines = await flushJsonlDecoder(split.state);

		expect(split.lines).toEqual([]);
		expect(lines).toEqual([
			`{"protocol":"${plotProtocolVersion}","kind":"request","id":"r1","command":"ping"}`,
		]);
	});

	test("parses and validates client JSON lines", async () => {
		const request = await parsePlotClientJsonLine(
			`{"protocol":"${plotProtocolVersion}","kind":"request","id":"r1","command":"attach_session","params":{"sessionId":"session-1","afterSequence":3}}`,
		);

		expect(request.command).toBe("attach_session");
		expect(request.params).toEqual({
			sessionId: "session-1",
			afterSequence: 3,
		});
	});

	test("reports parse errors distinctly from schema errors", async () => {
		let parseFailure: { code: string } | undefined;
		let schemaFailure: { code: string } | undefined;
		try {
			await parsePlotClientJsonLine("not-json");
		} catch (error) {
			parseFailure = error as { code: string };
		}
		try {
			await parsePlotClientJsonLine(
				`{"protocol":"${plotProtocolVersion}","kind":"request","id":"r1","command":"prompt"}`,
			);
		} catch (error) {
			schemaFailure = error as { code: string };
		}

		expect(parseFailure?.code).toBe("parse_error");
		expect(schemaFailure?.code).toBe("invalid_request");
	});
});
