import { expect, test } from "bun:test";
import {
	areaPathFrom,
	monotonePath,
	type PathPoint,
} from "../src/components/ui/live-line/path.js";
import {
	buildRenderData,
	computeTargetRange,
	makeLinearScale,
	nice,
} from "../src/components/ui/live-line/scale.js";

const numbersIn = (d: string): number[] =>
	(d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);

/** Endpoints the path actually passes through: the M point plus the final
 * coordinate pair of every L and C command. */
const segmentEndpoints = (d: string): Array<[number, number]> => {
	const commands = d.match(/[MLC][^MLC]*/g) ?? [];
	return commands.map((command) => {
		const nums = numbersIn(command);
		return [nums.at(-2) ?? Number.NaN, nums.at(-1) ?? Number.NaN];
	});
};

test("monotone path starts at M, stays finite, and passes through every input point", () => {
	const points: PathPoint[] = [
		[0, 0],
		[10, 20],
		[20, 5],
		[30, 30],
	];
	const d = monotonePath(points);
	expect(d.startsWith("M")).toBe(true);
	const nums = numbersIn(d);
	expect(nums.length).toBeGreaterThan(0);
	for (const n of nums) {
		expect(Number.isFinite(n)).toBe(true);
	}
	expect(segmentEndpoints(d)).toEqual([
		[0, 0],
		[10, 20],
		[20, 5],
		[30, 30],
	]);
});

test("area path closes down to the baseline", () => {
	const points: PathPoint[] = [
		[0, 10],
		[10, 5],
		[20, 8],
	];
	const d = areaPathFrom(points, 100);
	expect(d.startsWith(monotonePath(points))).toBe(true);
	expect(d.endsWith("L20,100L0,100Z")).toBe(true);
});

test("nice expands to round power-of-10 boundaries", () => {
	expect(nice([3, 97])).toEqual([0, 100]);
	const [lo, hi] = nice([0.12, 0.87]);
	expect(lo).toBeCloseTo(0.1, 9);
	expect(hi).toBeCloseTo(0.9, 9);
});

test("linear scale ticks are evenly spaced round values inside the domain", () => {
	const scale = makeLinearScale([0, 100], [100, 0]);
	const ticks = scale.ticks(4);
	expect(ticks.length).toBeGreaterThanOrEqual(3);
	const step = (ticks[1] ?? 0) - (ticks[0] ?? 0);
	for (let i = 1; i < ticks.length; i++) {
		expect((ticks[i] ?? 0) - (ticks[i - 1] ?? 0)).toBeCloseTo(step, 9);
	}
	for (const t of ticks) {
		expect(t).toBeGreaterThanOrEqual(0);
		expect(t).toBeLessThanOrEqual(100);
	}
});

test("linear scale maps domain to range", () => {
	const scale = makeLinearScale([0, 10], [100, 0]);
	expect(scale(0)).toBe(100);
	expect(scale(10)).toBe(0);
	expect(scale(5)).toBe(50);
});

test("computeTargetRange falls back to 0..100 on empty data", () => {
	expect(computeTargetRange([], 42, false)).toEqual({ yMin: 0, yMax: 100 });
});

test("computeTargetRange pads tighter when exaggerated", () => {
	const data = [
		{ time: 1, value: 10 },
		{ time: 2, value: 20 },
	];
	const normal = computeTargetRange(data, 15, false);
	const tight = computeTargetRange(data, 15, true);
	expect(normal.yMin).toBeCloseTo(8.5, 9);
	expect(normal.yMax).toBeCloseTo(21.5, 9);
	expect(tight.yMin).toBeCloseTo(9.7, 9);
	expect(tight.yMax).toBeCloseTo(20.3, 9);
	expect(tight.yMax - tight.yMin).toBeLessThan(normal.yMax - normal.yMin);
});

test("computeTargetRange includes the live value in the range", () => {
	const data = [
		{ time: 1, value: 10 },
		{ time: 2, value: 20 },
	];
	const range = computeTargetRange(data, 50, false);
	expect(range.yMax).toBeGreaterThan(50);
	expect(range.yMin).toBeLessThan(10);
});

test("buildRenderData slices to window, keeps one point before its start, and appends both virtual tip points", () => {
	const data = Array.from({ length: 100 }, (_, i) => ({
		time: i,
		value: i * 2,
	}));
	const nowMs = 99_000;
	const windowStartMs = 70_000;
	const out = buildRenderData(data, "value", {
		windowStartMs,
		nowMs,
		xTickUnitMs: 5000,
		displayValue: 123.45,
	});
	// One point before the window start, then everything inside it.
	expect(out[0]?.time).toBe(69_000);
	expect(out[1]?.time).toBe(70_000);
	// Points, plus the two virtual tip points.
	expect(out.length).toBe(31 + 2);
	const tip = out.at(-2);
	const runway = out.at(-1);
	expect(tip?.time).toBe(nowMs);
	expect(tip?.["value"]).toBe(123.45);
	expect(runway?.time).toBe(nowMs + 5000);
	expect(runway?.["value"]).toBe(123.45);
});

test("buildRenderData with empty data still emits the two virtual tip points", () => {
	const out = buildRenderData([], "value", {
		windowStartMs: 0,
		nowMs: 30_000,
		xTickUnitMs: 7500,
		displayValue: 7,
	});
	expect(out.map((d) => d.time)).toEqual([30_000, 37_500]);
	expect(out.every((d) => d["value"] === 7)).toBe(true);
});
