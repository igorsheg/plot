/**
 * Pure scale math for the live line chart: linear/time scale factories with
 * d3-style nice() and ticks(), plus the pure data helpers that feed rendering.
 * No DOM, no React — everything here is unit-testable.
 */

export interface LiveLinePoint {
	/** Unix time in seconds. */
	time: number;
	value: number;
}

export interface LinearScale {
	(value: number): number;
	domain: () => [number, number];
	range: () => [number, number];
	ticks: (count?: number) => number[];
}

export interface TimeScale {
	(timeMs: number): number;
	/** Domain in unix milliseconds. */
	domain: () => [number, number];
	range: () => [number, number];
}

/**
 * d3-style nice: expand the domain outward to round power-of-10 boundaries.
 */
export function nice(domain: readonly [number, number]): [number, number] {
	const [min, max] = domain;
	const span = max - min;
	if (!(span > 0) || !Number.isFinite(span)) {
		return [min, max];
	}
	const step = 10 ** Math.floor(Math.log10(span));
	return [Math.floor(min / step) * step, Math.ceil(max / step) * step];
}

/** d3-style tick step: a power of 10 times 1, 2 or 5. */
function tickStep(min: number, max: number, count: number): number {
	const span = Math.abs(max - min);
	const raw = span / Math.max(1, count);
	if (!(raw > 0) || !Number.isFinite(raw)) {
		return 0;
	}
	const power = Math.floor(Math.log10(raw));
	const error = raw / 10 ** power;
	let factor = 1;
	if (error >= Math.sqrt(50)) {
		factor = 10;
	} else if (error >= Math.sqrt(10)) {
		factor = 5;
	} else if (error >= Math.sqrt(2)) {
		factor = 2;
	}
	return factor * 10 ** power;
}

/** Evenly spaced round tick values covering [min, max]. */
export function linearTicks(min: number, max: number, count = 10): number[] {
	if (min === max) {
		return [min];
	}
	const step = tickStep(min, max, count);
	if (step === 0) {
		return [];
	}
	const start = Math.ceil(min / step);
	const stop = Math.floor(max / step);
	const values: number[] = [];
	for (let i = start; i <= stop; i++) {
		values.push(Math.round(i * step * 1e10) / 1e10);
	}
	return values;
}

export function makeLinearScale(
	domain: readonly [number, number],
	range: readonly [number, number],
	options?: { nice?: boolean },
): LinearScale {
	const [d0, d1] = options?.nice ? nice(domain) : domain;
	const [r0, r1] = range;
	const span = d1 - d0;
	const scale = ((value: number) =>
		span === 0 ? r0 : r0 + ((value - d0) / span) * (r1 - r0)) as LinearScale;
	scale.domain = () => [d0, d1];
	scale.range = () => [r0, r1];
	scale.ticks = (count = 10) => linearTicks(d0, d1, count);
	return scale;
}

export function makeTimeScale(
	domainMs: readonly [number, number],
	range: readonly [number, number],
): TimeScale {
	const [d0, d1] = domainMs;
	const [r0, r1] = range;
	const span = d1 - d0;
	const scale = ((timeMs: number) =>
		span === 0 ? r0 : r0 + ((timeMs - d0) / span) * (r1 - r0)) as TimeScale;
	scale.domain = () => [d0, d1];
	scale.range = () => [r0, r1];
	return scale;
}

/**
 * Target y-range for the lerp loop: data extent plus the live value, padded.
 * Exaggerate mode keeps the padding tight so small moves look big.
 */
export function computeTargetRange(
	data: readonly LiveLinePoint[],
	value: number,
	exaggerate: boolean,
): { yMin: number; yMax: number } {
	if (data.length === 0) {
		return { yMin: 0, yMax: 100 };
	}
	let min = Number.POSITIVE_INFINITY;
	let max = Number.NEGATIVE_INFINITY;
	for (const d of data) {
		if (d.value < min) {
			min = d.value;
		}
		if (d.value > max) {
			max = d.value;
		}
	}
	if (value < min) {
		min = value;
	}
	if (value > max) {
		max = value;
	}
	const rawRange = max - min;
	const paddingFactor = exaggerate ? 0.03 : 0.15;
	const rangePad = rawRange * paddingFactor || (exaggerate ? 0.04 : 10);
	return { yMin: min - rangePad, yMax: max + rangePad };
}

export type RenderDatum = Record<string, unknown> & { time: number };

/** Binary search: index of the first point with time >= target (seconds). */
function bisectTime(data: readonly LiveLinePoint[], timeSec: number): number {
	let lo = 0;
	let hi = data.length;
	while (lo < hi) {
		const mid = (lo + hi) >>> 1;
		const point = data[mid];
		if (point !== undefined && point.time < timeSec) {
			lo = mid + 1;
		} else {
			hi = mid;
		}
	}
	return lo;
}

/**
 * Build the render-ready data slice:
 * - keeps points inside the visible window plus one point before its start
 *   (so the curve enters the frame already drawn),
 * - appends two virtual points at `now` and `now + xTickUnit` carrying the
 *   lerped display value (the live tip and the fade-out runway).
 * Times in the output are unix milliseconds.
 */
export function buildRenderData(
	data: readonly LiveLinePoint[],
	dataKey: string,
	options: {
		windowStartMs: number;
		nowMs: number;
		xTickUnitMs: number;
		displayValue: number;
	},
): RenderDatum[] {
	const { windowStartMs, nowMs, xTickUnitMs, displayValue } = options;
	let startIdx = bisectTime(data, windowStartMs / 1000);
	if (startIdx > 0) {
		startIdx--;
	}
	const records: RenderDatum[] = [];
	for (let i = startIdx; i < data.length; i++) {
		const point = data[i];
		if (point !== undefined) {
			records.push({ time: point.time * 1000, [dataKey]: point.value });
		}
	}
	// Virtual point 1: the "now" position where the live dot sits.
	records.push({ time: nowMs, [dataKey]: displayValue });
	// Virtual point 2: queued ahead — the line extends and fades into this.
	records.push({ time: nowMs + xTickUnitMs, [dataKey]: displayValue });
	return records;
}
