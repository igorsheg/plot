type ColorMode = "truecolor" | "256color";
type ColorValue = string | number;

type ColorName =
	| "accent"
	| "border"
	| "success"
	| "error"
	| "warning"
	| "muted"
	| "dim"
	| "text"
	| "selectedBg";

const colorEnabled =
	process.env["NO_COLOR"] === undefined && process.env["TERM"] !== "dumb";

const colorMode = (): ColorMode => {
	const colorTerm = process.env["COLORTERM"]?.toLowerCase() ?? "";
	if (colorTerm === "truecolor" || colorTerm === "24bit") return "truecolor";
	if ((process.env["TERM"] ?? "").includes("truecolor")) return "truecolor";
	return "256color";
};

const palette = {
	accent: "#8abeb7",
	border: "#505050",
	success: "#b5bd68",
	error: "#cc6666",
	warning: "#f0c674",
	muted: "#808080",
	dim: "#666666",
	text: "#d4d4d4",
	selectedBg: "#3a3a4a",
} satisfies Record<ColorName, ColorValue>;

const ansi = {
	reset: "\x1b[0m",
	bold: "\x1b[1m",
	inverse: "\x1b[7m",
};

function hexToRgb(hex: string): { r: number; g: number; b: number } {
	const cleaned = hex.replace("#", "");
	return {
		r: Number.parseInt(cleaned.substring(0, 2), 16),
		g: Number.parseInt(cleaned.substring(2, 4), 16),
		b: Number.parseInt(cleaned.substring(4, 6), 16),
	};
}

const cubeValues = [0, 95, 135, 175, 215, 255];
const grayValues = Array.from({ length: 24 }, (_, i) => 8 + i * 10);

const closestIndex = (value: number, values: readonly number[]) => {
	let best = 0;
	let bestDistance = Infinity;
	for (let i = 0; i < values.length; i++) {
		const distance = Math.abs(value - values[i]!);
		if (distance < bestDistance) {
			best = i;
			bestDistance = distance;
		}
	}
	return best;
};

const colorDistance = (
	r1: number,
	g1: number,
	b1: number,
	r2: number,
	g2: number,
	b2: number,
) => {
	const dr = r1 - r2;
	const dg = g1 - g2;
	const db = b1 - b2;
	return dr * dr * 0.299 + dg * dg * 0.587 + db * db * 0.114;
};

const rgbTo256 = (r: number, g: number, b: number): number => {
	const rIdx = closestIndex(r, cubeValues);
	const gIdx = closestIndex(g, cubeValues);
	const bIdx = closestIndex(b, cubeValues);
	const cubeR = cubeValues[rIdx]!;
	const cubeG = cubeValues[gIdx]!;
	const cubeB = cubeValues[bIdx]!;
	const cubeIndex = 16 + 36 * rIdx + 6 * gIdx + bIdx;
	const cubeDist = colorDistance(r, g, b, cubeR, cubeG, cubeB);
	const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
	const grayIdx = closestIndex(gray, grayValues);
	const grayValue = grayValues[grayIdx]!;
	const grayDist = colorDistance(r, g, b, grayValue, grayValue, grayValue);
	const spread = Math.max(r, g, b) - Math.min(r, g, b);
	return spread < 10 && grayDist < cubeDist ? 232 + grayIdx : cubeIndex;
};

const fgAnsi = (color: ColorValue, mode: ColorMode): string => {
	if (typeof color === "number") return `\x1b[38;5;${color}m`;
	const { r, g, b } = hexToRgb(color);
	if (mode === "truecolor") return `\x1b[38;2;${r};${g};${b}m`;
	return `\x1b[38;5;${rgbTo256(r, g, b)}m`;
};

const bgAnsi = (color: ColorValue, mode: ColorMode): string => {
	if (typeof color === "number") return `\x1b[48;5;${color}m`;
	const { r, g, b } = hexToRgb(color);
	if (mode === "truecolor") return `\x1b[48;2;${r};${g};${b}m`;
	return `\x1b[48;5;${rgbTo256(r, g, b)}m`;
};

const fg = (color: ColorName) => (value: string) =>
	colorEnabled
		? `${fgAnsi(palette[color], colorMode())}${value}\x1b[39m`
		: value;
const bg = (color: ColorName) => (value: string) =>
	colorEnabled
		? `${bgAnsi(palette[color], colorMode())}${value}\x1b[49m`
		: value;
const compose =
	(...fns: readonly ((value: string) => string)[]) =>
	(value: string) =>
		fns.reduce((current, fn) => fn(current), value);
const bold = (value: string) =>
	colorEnabled ? `${ansi.bold}${value}\x1b[22m` : value;
const inverse = (value: string) =>
	colorEnabled ? `${ansi.inverse}${value}${ansi.reset}` : value;

// Hue is reserved for state: green = healthy, yellow = waiting on something,
// red = needs a human. Hierarchy comes from weight and brightness.
export const style = {
	brand: compose(fg("text"), bold),
	label: compose(fg("text"), bold),
	text: fg("text"),
	value: fg("text"),
	accent: fg("accent"),
	muted: fg("muted"),
	dim: fg("dim"),
	border: fg("border"),
	inverse,
	ok: fg("success"),
	warn: fg("warning"),
	bad: compose(fg("error"), bold),
	status: {
		running: fg("success"),
		idle: fg("muted"),
		warning: fg("warning"),
		error: compose(fg("error"), bold),
		success: fg("success"),
	},
	stage: {
		pending: fg("muted"),
		waiting: fg("muted"),
		running: fg("success"),
		blocked: compose(fg("error"), bold),
		draining: fg("warning"),
		done: fg("success"),
		failed: compose(fg("error"), bold),
		starting: fg("muted"),
		working: fg("text"),
		verifying: fg("warning"),
		finishing: fg("success"),
	},
	row: {
		selected: compose(bg("selectedBg"), fg("text")),
		stale: fg("dim"),
	},
} as const;
