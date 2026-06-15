import { useId } from "react";

import { cn } from "@/lib/utils";

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
	const d = data
		.map(
			(value, index) =>
				`${index === 0 ? "M" : "L"}${x(index).toFixed(1)} ${y(value).toFixed(1)}`,
		)
		.join(" ");

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
