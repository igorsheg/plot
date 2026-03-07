import { afterEach, describe, expect, test } from "bun:test";
import { connectSse, type SseStatus } from "./sse.js";

const originalFetch = globalThis.fetch;
const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;
const originalWarn = console.warn;
const encoder = new TextEncoder();

type TimerHandler = () => void;

function makeResponse(lines: string[]) {
	return new Response(
		new ReadableStream<Uint8Array>({
			start(controller) {
				for (const line of lines) {
					controller.enqueue(encoder.encode(line));
				}
				controller.close();
			},
		}),
		{
			status: 200,
			headers: { "Content-Type": "text/event-stream" },
		},
	);
}

afterEach(() => {
	globalThis.fetch = originalFetch;
	globalThis.setTimeout = originalSetTimeout;
	globalThis.clearTimeout = originalClearTimeout;
	console.warn = originalWarn;
});

describe("connectSse", () => {
	test("decodes valid events and ignores malformed payloads", async () => {
		const warnings: string[] = [];
		console.warn = (...args) => {
			warnings.push(args.map(String).join(" "));
		};
		globalThis.fetch = (async (..._args: Parameters<typeof fetch>) =>
			makeResponse([
				`data: ${JSON.stringify({
					event: "session_started",
					timestamp: new Date("2026-01-01T00:00:00.000Z").toISOString(),
					agentPid: null,
					issueId: "1",
					issueIdentifier: "plot-1",
					sessionId: null,
					message: "started",
				})}\n`,
				`data: ${JSON.stringify({ event: "session_started" })}\n`,
				"\n",
			])) as typeof fetch;

		const statuses: SseStatus[] = [];
		const events: Array<{ issueId: string; message: string | null }> = [];

		const connection = connectSse(
			"http://example.test/events",
			(event) => {
				events.push({ issueId: event.issueId, message: event.message });
			},
			(status) => {
				statuses.push(status);
			},
		);

		await Bun.sleep(25);
		connection.close();

		expect(events).toEqual([{ issueId: "1", message: "started" }]);
		expect(statuses).toEqual([
			"connecting",
			"connected",
			"disconnected",
			"reconnecting",
			"disconnected",
		]);
		expect(warnings).toHaveLength(1);
	});

	test("schedules a reconnect when the stream ends", async () => {
		const timers: TimerHandler[] = [];
		globalThis.setTimeout = ((handler: TimerHandler) => {
			timers.push(handler);
			return timers.length as unknown as ReturnType<typeof setTimeout>;
		}) as typeof setTimeout;
		globalThis.clearTimeout = ((_timer) => undefined) as typeof clearTimeout;
		console.warn = () => {};
		globalThis.fetch = (async (..._args: Parameters<typeof fetch>) =>
			makeResponse([])) as typeof fetch;

		const statuses: SseStatus[] = [];
		const connection = connectSse(
			"http://example.test/events",
			() => {},
			(status) => {
				statuses.push(status);
			},
		);

		await Bun.sleep(25);
		connection.close();

		expect(statuses).toEqual([
			"connecting",
			"connected",
			"disconnected",
			"reconnecting",
			"disconnected",
		]);
		expect(timers).toHaveLength(1);
	});

	test("close clears a pending reconnect and prevents another fetch", async () => {
		const timers: TimerHandler[] = [];
		const cleared: Array<ReturnType<typeof setTimeout>> = [];
		let fetchCalls = 0;
		globalThis.setTimeout = ((handler: TimerHandler) => {
			timers.push(handler);
			return timers.length as unknown as ReturnType<typeof setTimeout>;
		}) as typeof setTimeout;
		globalThis.clearTimeout = ((timer) => {
			if (timer !== undefined) {
				cleared.push(timer as ReturnType<typeof setTimeout>);
			}
		}) as typeof clearTimeout;
		console.warn = () => {};
		globalThis.fetch = (async (..._args: Parameters<typeof fetch>) => {
			fetchCalls += 1;
			throw new Error("offline");
		}) as unknown as typeof fetch;

		const statuses: SseStatus[] = [];
		const connection = connectSse(
			"http://example.test/events",
			() => {},
			(status) => {
				statuses.push(status);
			},
		);

		await Bun.sleep(25);
		connection.close();
		for (const timer of timers) {
			timer();
		}
		await Bun.sleep(25);

		expect(fetchCalls).toBe(1);
		expect(cleared).toHaveLength(1);
		expect(statuses).toEqual([
			"connecting",
			"disconnected",
			"reconnecting",
			"disconnected",
		]);
	});
});
