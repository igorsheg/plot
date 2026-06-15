import type { TokenSample } from "@plot/control/projection";

// Bucket cumulative token samples into a tokens-per-second series over a trailing
// window — the numeric counterpart of the model's ASCII throughput graph, at a
// finer resolution for a smooth sparkline. Mirrors dashboard-model's bucketing
// (delta of cumulative tokens per bucket), expressed as a rate.
export function throughputSeries(
	samples: readonly TokenSample[],
	nowMs: number,
	{
		windowMs = 60_000,
		buckets = 24,
	}: { windowMs?: number; buckets?: number } = {},
): number[] {
	const windowStart = nowMs - windowMs;
	const recent = samples.filter((sample) => sample.atMs >= windowStart);
	const first = recent[0];
	if (first === undefined || recent.length < 2) return [];
	const bucketMs = windowMs / buckets;
	const bucketSeconds = bucketMs / 1000;
	const tokensAtOrBefore = (atMs: number) =>
		recent.findLast((sample) => sample.atMs <= atMs)?.tokens ?? first.tokens;
	return Array.from({ length: buckets }, (_, index) => {
		const start = windowStart + index * bucketMs;
		const end = start + bucketMs;
		return Math.max(
			0,
			(tokensAtOrBefore(end) - tokensAtOrBefore(start)) / bucketSeconds,
		);
	});
}
