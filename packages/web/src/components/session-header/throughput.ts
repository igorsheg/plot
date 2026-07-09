import type { SerializedDashboardProjection } from "@plot/projection";

export interface ThroughputModel {
	readonly rate: number;
	readonly graph: string;
}

export const THROUGHPUT_WINDOW_MS = 60_000;
export const THROUGHPUT_BUCKETS = 8;

export const SPARK_CHARS = "▁▂▃▄▅▆▇█";

const emptyGraph = (): string =>
	SPARK_CHARS[0]?.repeat(THROUGHPUT_BUCKETS) ?? "";

export const emptyThroughput = (): ThroughputModel => ({
	rate: 0,
	graph: emptyGraph(),
});

export const formatTps = (value: number): string => {
	if (value < 10) return value.toFixed(1);
	if (value < 1000) return String(Math.round(value));
	return `${(value / 1000).toFixed(1)}k`;
};

const bucketDeltas = (input: {
	readonly samples: readonly {
		readonly atMs: number;
		readonly tokens: number;
	}[];
	readonly windowStart: number;
	readonly bucketMs: number;
}): readonly number[] => {
	const buckets = Array.from({ length: THROUGHPUT_BUCKETS }, () => 0);
	for (let i = 1; i < input.samples.length; i++) {
		const previous = input.samples[i - 1];
		const current = input.samples[i];
		if (previous === undefined || current === undefined) continue;
		const delta = current.tokens - previous.tokens;
		const duration = current.atMs - previous.atMs;
		if (delta <= 0 || duration <= 0) continue;
		const segmentStart = Math.max(previous.atMs, input.windowStart);
		const segmentEnd = current.atMs;
		if (segmentEnd <= segmentStart) continue;
		for (let bucket = 0; bucket < THROUGHPUT_BUCKETS; bucket++) {
			const bucketStart = input.windowStart + bucket * input.bucketMs;
			const bucketEnd = bucketStart + input.bucketMs;
			const overlap = Math.max(
				0,
				Math.min(segmentEnd, bucketEnd) - Math.max(segmentStart, bucketStart),
			);
			if (overlap > 0)
				buckets[bucket] = (buckets[bucket] ?? 0) + delta * (overlap / duration);
		}
	}
	return buckets;
};
export const tokenThroughput = (
	projection: Pick<SerializedDashboardProjection, "tokenSamples"> | undefined,
	nowMs: number,
): ThroughputModel => {
	if (projection === undefined) return emptyThroughput();
	const windowStart = nowMs - THROUGHPUT_WINDOW_MS;
	const recent = projection.tokenSamples.filter(
		(sample) => sample.atMs >= windowStart,
	);
	if (recent.length < 2) return emptyThroughput();
	const first = recent[0];
	const last = recent.at(-1);
	if (first === undefined || last === undefined || last.atMs <= first.atMs)
		return emptyThroughput();
	const rate = ((last.tokens - first.tokens) * 1000) / (last.atMs - first.atMs);
	const bucketMs = THROUGHPUT_WINDOW_MS / THROUGHPUT_BUCKETS;
	const buckets = bucketDeltas({
		samples: recent,
		windowStart,
		bucketMs,
	});
	const max = Math.max(...buckets, 1);
	const graph = buckets
		.map(
			(value) =>
				SPARK_CHARS[Math.ceil((value / max) * (SPARK_CHARS.length - 1))] ??
				SPARK_CHARS[0],
		)
		.join("");
	return { rate, graph };
};
