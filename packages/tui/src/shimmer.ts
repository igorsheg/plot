import { style } from "./style.js";

const leadPadCols = 6;
const tailPadCols = 10;
const bandHalfWidth = 2;
const stepMs = 80;

const graphemes = (text: string): readonly string[] => {
	const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
	return [...segmenter.segment(text)].map((segment) => segment.segment);
};

const bucketForColumn = (phase: number, visualCol: number) => {
	const textPos = leadPadCols + visualCol;
	const dist = Math.abs(textPos - phase);
	if (dist === 0) return "peak";
	if (dist > bandHalfWidth) return "base";
	return dist * 2 <= bandHalfWidth ? "peak" : "edge";
};

export const shimmerText = (text: string, nowMs: number): string => {
	const chars = graphemes(text);
	if (chars.length === 0) return text;
	const period = chars.length + leadPadCols + tailPadCols;
	const phase = Math.floor(nowMs / stepMs) % period;
	return chars
		.map((char, index) => {
			const bucket = bucketForColumn(phase, index);
			if (bucket === "peak") return style.label(char);
			if (bucket === "edge") return style.text(char);
			return style.muted(char);
		})
		.join("");
};

export const quoteActivity = (activity: string) => {
	const commandOutput = activity.replace(/^command output streaming:\s*/, "");
	if (commandOutput !== activity) return commandOutput;
	const stripped = activity.replace(
		/^(agent message|reasoning) streaming:\s*/,
		"",
	);
	return stripped === activity ? activity : `“${stripped}”`;
};
