import { expect, test } from "bun:test";
import { headerVariant } from "../src/components/session-header/session-header.js";
import {
	formatTps,
	THROUGHPUT_BUCKETS,
	tokenThroughput,
} from "../src/components/session-header/throughput.js";
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

test("tokenThroughput turns projection samples into total token TPS", () => {
	const model = tokenThroughput(
		{
			tokenSamples: [
				{ atMs: AT - 10_000, tokens: 100 },
				{ atMs: AT, tokens: 150 },
			],
		},
		AT,
	);
	expect(model.rate).toBe(5);
	expect(model.graph).toHaveLength(THROUGHPUT_BUCKETS);
	expect(model.graph).toBe("▁▁▁▁▁▁▁█");
});

test("tokenThroughput returns empty buckets without enough samples", () => {
	const model = tokenThroughput(
		{ tokenSamples: [{ atMs: AT, tokens: 100 }] },
		AT,
	);
	expect(model.rate).toBe(0);
	expect(model.graph).toHaveLength(THROUGHPUT_BUCKETS);
	expect(model.graph).toBe("▁▁▁▁▁▁▁▁");
});

test("formatTps keeps compact labels", () => {
	expect(formatTps(3.25)).toBe("3.3");
	expect(formatTps(42.2)).toBe("42");
	expect(formatTps(1530)).toBe("1.5k");
});

test("headerVariant maps status to an explicit variant", () => {
	expect(headerVariant("online")).toBe("live");
	expect(headerVariant("stopping")).toBe("live");
	expect(headerVariant("starting")).toBe("starting");
	expect(headerVariant("error")).toBe("errored");
	expect(headerVariant("stopped")).toBe("stopped");
});
