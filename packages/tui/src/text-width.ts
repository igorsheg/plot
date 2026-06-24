const ansiPattern = /\x1b\[[0-?]*[ -/]*[@-~]/g;

export const stripAnsi = (value: string): string =>
	value.replace(ansiPattern, "");

const segments = (value: string): string[] => {
	const Segmenter = Intl.Segmenter;
	const segmenter = new Segmenter(undefined, { granularity: "grapheme" });
	return [...segmenter.segment(value)].map((part) => part.segment);
};

const isWide = (codePoint: number): boolean =>
	(codePoint >= 0x1100 && codePoint <= 0x115f) ||
	(codePoint >= 0x2329 && codePoint <= 0x232a) ||
	(codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
	(codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
	(codePoint >= 0xf900 && codePoint <= 0xfaff) ||
	(codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
	(codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
	(codePoint >= 0xff00 && codePoint <= 0xff60) ||
	(codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
	(codePoint >= 0x1f300 && codePoint <= 0x1faff);

const segmentWidth = (segment: string): number => {
	if (/^\p{Mark}+$/u.test(segment)) return 0;
	const codePoint = segment.codePointAt(0);
	if (codePoint === undefined) return 0;
	if (codePoint < 32 || (codePoint >= 0x7f && codePoint < 0xa0)) return 0;
	return isWide(codePoint) ? 2 : 1;
};

export const visibleWidth = (value: string): number =>
	segments(stripAnsi(value)).reduce(
		(sum, segment) => sum + segmentWidth(segment),
		0,
	);

export const truncateToWidth = (
	value: string,
	width: number,
	ellipsis = "…",
): string => {
	if (visibleWidth(value) <= width) return value;
	const target = Math.max(0, width - visibleWidth(ellipsis));
	let output = "";
	let used = 0;
	for (const segment of segments(stripAnsi(value))) {
		const next = segmentWidth(segment);
		if (used + next > target) break;
		output += segment;
		used += next;
	}
	return `${output}${ellipsis}`;
};
