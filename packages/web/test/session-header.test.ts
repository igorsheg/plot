import { expect, test } from "bun:test";
import { headerVariant } from "../src/components/session-header/session-header.js";
import {
	latestRate,
	PULSE_CAP,
	type PulseBuffer,
	pushSample,
	rateSeries,
} from "../src/components/session-header/pulse.js";
import { formatRelative } from "../src/lib/relative-time.js";

const AT = 1_000_000_000_000;

test("formatRelative renders coarse seconds and clamps 0 to 1", () => {
	expect(formatRelative(AT, AT)).toBe("1s ago");
	expect(formatRelative(AT - 4_000, AT)).toBe("4s ago");
	expect(formatRelative(AT + 500, AT)).toBe("1s ago");
});

test("formatRelative crosses to minutes just before a minute", () => {
	expect(formatRelative(AT - 44_000, AT)).toBe("44s ago");
	expect(formatRelative(AT - 59_000, AT)).toBe("1m ago");
});

test("formatRelative crosses minutes to hours at 45m", () => {
	expect(formatRelative(AT - 44 * 60_000, AT)).toBe("44m ago");
	expect(formatRelative(AT - 45 * 60_000, AT)).toBe("1h ago");
});

test("formatRelative crosses hours to days near a day", () => {
	expect(formatRelative(AT - 21 * 3_600_000, AT)).toBe("21h ago");
	expect(formatRelative(AT - 22 * 3_600_000, AT)).toBe("1d ago");
	expect(formatRelative(AT - 3 * 86_400_000, AT)).toBe("3d ago");
});

test("rateSeries turns Δseq 5 over 10s into 30 events/min", () => {
	const buf = [
		{ atMs: 0, sequence: 100 },
		{ atMs: 10_000, sequence: 105 },
	];
	const series = rateSeries(buf);
	expect(series).toEqual([{ time: 10, value: 30 }]);
	expect(latestRate(series)).toBe(30);
});

test("rateSeries skips a pair on registry sequence reset", () => {
	const buf = [
		{ atMs: 0, sequence: 100 },
		{ atMs: 10_000, sequence: 3 },
	];
	expect(rateSeries(buf)).toEqual([]);
	expect(latestRate([])).toBe(0);
});

test("rateSeries skips a pair with non-positive Δt", () => {
	const buf = [
		{ atMs: 10_000, sequence: 1 },
		{ atMs: 10_000, sequence: 9 },
	];
	expect(rateSeries(buf)).toEqual([]);
});

test("a fresh buffer (run-id change reset) yields no pairs until a second sample", () => {
	const reset: PulseBuffer = [];
	const one = pushSample(reset, { atMs: 5_000, sequence: 42 });
	expect(one).toHaveLength(1);
	expect(rateSeries(one)).toEqual([]);
});

test("pushSample caps the buffer at PULSE_CAP most-recent samples", () => {
	let buf: PulseBuffer = [];
	for (let i = 0; i < PULSE_CAP + 8; i++) {
		buf = pushSample(buf, { atMs: i * 1_000, sequence: i });
	}
	expect(buf).toHaveLength(PULSE_CAP);
	expect(buf[0]?.sequence).toBe(8);
	expect(buf.at(-1)?.sequence).toBe(PULSE_CAP + 7);
});

test("headerVariant maps status to an explicit variant", () => {
	expect(headerVariant("online")).toBe("live");
	expect(headerVariant("stopping")).toBe("live");
	expect(headerVariant("starting")).toBe("starting");
	expect(headerVariant("error")).toBe("errored");
	expect(headerVariant("stopped")).toBe("stopped");
});
