/**
 * Pure SVG path builders. `monotonePath` ports d3's curveMonotoneX
 * (Fritsch–Carlson monotone cubic interpolation) so the curve never
 * overshoots between samples. No DOM, no React.
 */

export type PathPoint = readonly [number, number];

function sign(x: number): number {
	return x < 0 ? -1 : 1;
}

/**
 * Three-point tangent estimate (Fritsch–Carlson). Mirrors d3's slope3.
 */
function slope3(
	x0: number,
	y0: number,
	x1: number,
	y1: number,
	x2: number,
	y2: number,
): number {
	const h0 = x1 - x0;
	const h1 = x2 - x1;
	const s0 = (y1 - y0) / (h0 || (h1 < 0 ? -0 : 0));
	const s1 = (y2 - y1) / (h1 || (h0 < 0 ? -0 : 0));
	const p = (s0 * h1 + s1 * h0) / (h0 + h1);
	return (
		(sign(s0) + sign(s1)) *
			Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p)) || 0
	);
}

/** One-sided tangent for the endpoints. Mirrors d3's slope2. */
function slope2(x0: number, y0: number, x1: number, y1: number, t: number) {
	const h = x1 - x0;
	return h ? (3 * (y1 - y0)) / h - t : t;
}

function fmt(n: number): string {
	return String(Math.round(n * 1000) / 1000);
}

function bezier(
	x0: number,
	y0: number,
	x1: number,
	y1: number,
	t0: number,
	t1: number,
): string {
	const dx = (x1 - x0) / 3;
	return `C${fmt(x0 + dx)},${fmt(y0 + dx * t0)},${fmt(x1 - dx)},${fmt(
		y1 - dx * t1,
	)},${fmt(x1)},${fmt(y1)}`;
}

/**
 * Monotone-x cubic line path through `points` ([x, y] pairs, ascending x).
 * Produces the same shape as d3's curveMonotoneX.
 */
export function monotonePath(points: readonly PathPoint[]): string {
	if (points.length === 0) {
		return "";
	}
	const first = points[0] as PathPoint;
	if (points.length === 1) {
		return `M${fmt(first[0])},${fmt(first[1])}`;
	}
	let d = `M${fmt(first[0])},${fmt(first[1])}`;
	if (points.length === 2) {
		const last = points[1] as PathPoint;
		return `${d}L${fmt(last[0])},${fmt(last[1])}`;
	}
	let t0 = 0;
	for (let i = 1; i < points.length - 1; i++) {
		const [x0, y0] = points[i - 1] as PathPoint;
		const [x1, y1] = points[i] as PathPoint;
		const [x2, y2] = points[i + 1] as PathPoint;
		const t1 = slope3(x0, y0, x1, y1, x2, y2);
		const tStart = i === 1 ? slope2(x0, y0, x1, y1, t1) : t0;
		d += bezier(x0, y0, x1, y1, tStart, t1);
		t0 = t1;
	}
	const n = points.length;
	const [px, py] = points[n - 2] as PathPoint;
	const [lx, ly] = points[n - 1] as PathPoint;
	d += bezier(px, py, lx, ly, t0, slope2(px, py, lx, ly, t0));
	return d;
}

/**
 * Closed area path under the monotone curve down to `baselineY`.
 */
export function areaPathFrom(
	points: readonly PathPoint[],
	baselineY: number,
): string {
	if (points.length < 2) {
		return "";
	}
	const first = points[0] as PathPoint;
	const last = points[points.length - 1] as PathPoint;
	return `${monotonePath(points)}L${fmt(last[0])},${fmt(baselineY)}L${fmt(
		first[0],
	)},${fmt(baselineY)}Z`;
}
