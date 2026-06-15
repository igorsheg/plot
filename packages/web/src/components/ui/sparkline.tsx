import { useId } from "react";

import { cn } from "@/lib/utils";

// Smooth a polyline into a curve that passes through every point, via a
// Catmull-Rom spline expressed as cubic béziers — rounded corners instead of
// sharp polyline joins. The same `d` drives the glow's offset-path, so the
// pulse follows the curve too.
function smoothPath(points: readonly [number, number][]): string {
	const first = points[0];
	if (first === undefined) return "";
	let d = `M${first[0].toFixed(1)} ${first[1].toFixed(1)}`;
	for (let i = 0; i < points.length - 1; i++) {
		const p0 = points[i - 1] ?? points[i]!;
		const p1 = points[i]!;
		const p2 = points[i + 1]!;
		const p3 = points[i + 2] ?? p2;
		const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
		const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
		const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
		const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
		d += ` C${cp1x.toFixed(1)} ${cp1y.toFixed(1)} ${cp2x.toFixed(1)} ${cp2y.toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
	}
	return d;
}

// A token-driven sparkline with a glowing "pulse of light" travelling the line —
// the offset-path motion trick, but the path is generated from data (set inline,
// not a static CSS class) so the trail follows whatever the series draws. The
// line is muted; the glow is a radial gradient of `color` (a CSS var/token),
// masked to the path so only a moving segment lights up. Silenced under reduced
// motion (the static line remains).
export function Sparkline({
	data,
	width = 96,
	height = 24,
	color = "var(--foreground)",
	className,
}: {
	data: readonly number[];
	width?: number;
	height?: number;
	/** Glow colour — any CSS colour or token var. */
	color?: string;
	className?: string;
}) {
	const id = useId();
	const maskId = `spark-mask-${id}`;
	const gradId = `spark-grad-${id}`;
	if (data.length < 2) return null;

	const pad = 2;
	const max = Math.max(...data, 1);
	const x = (index: number) => (index / (data.length - 1)) * width;
	const y = (value: number) =>
		height - pad - (value / max) * (height - pad * 2);
	const points = data.map((value, index): [number, number] => [
		x(index),
		y(value),
	]);
	const d = smoothPath(points);

	return (
		<svg
			width={width}
			height={height}
			viewBox={`0 0 ${width} ${height}`}
			fill="none"
			aria-hidden
			className={cn("shrink-0 overflow-visible", className)}
		>
			<path
				d={d}
				stroke="currentColor"
				strokeWidth={1}
				strokeLinecap="round"
				strokeLinejoin="round"
				className="text-muted-foreground/50"
			/>
			<g mask={`url(#${maskId})`}>
				<circle
					cx={0}
					cy={0}
					r={height * 0.7}
					fill={`url(#${gradId})`}
					className="spark-trail"
					style={{ offsetPath: `path("${d}")` }}
				/>
			</g>
			<defs>
				<mask id={maskId}>
					<path d={d} stroke="white" strokeWidth={2} fill="none" />
				</mask>
				<radialGradient id={gradId} fx="1">
					<stop offset="0%" stopColor={color} />
					<stop offset="20%" stopColor={color} stopOpacity="0.8" />
					<stop offset="100%" stopColor="transparent" />
				</radialGradient>
			</defs>
		</svg>
	);
}
