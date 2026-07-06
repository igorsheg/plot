/**
 * Series renderer: monotone curve with trailing-edge fade, optional area
 * fill, dashed current-value line, pulsing live dot, and value badge.
 * Reads everything from chart context.
 */

import { useId } from "react";
import { useChart } from "./chart-context.js";
import { areaPathFrom, monotonePath, type PathPoint } from "./path.js";
import { usePrefersReducedMotion } from "./use-parent-size.js";

const DEFAULT_STROKE = "var(--color-kumo-info)";

export interface LiveLineProps {
	/** Key in render data to use for y values. */
	dataKey: string;
	/** Stroke color. Default: var(--color-kumo-info). */
	stroke?: string;
	/** Stroke width. Default: 2. */
	strokeWidth?: number;
	/** Show gradient fill under the curve. Default: true. */
	fill?: boolean;
	/** Show pulsing ring on the live dot. Default: true. */
	pulse?: boolean;
	/** Radius of the live dot. Default: 4. */
	dotSize?: number;
	/** Show value badge pill at the live tip. Default: true. */
	badge?: boolean;
	/** Show the dashed horizontal guide at the current value. Default: true. */
	guide?: boolean;
	/** Value label formatter for the badge. */
	formatValue?: (v: number) => string;
}

export function LiveLine({
	dataKey,
	stroke = DEFAULT_STROKE,
	strokeWidth = 2,
	fill = true,
	pulse = true,
	dotSize = 4,
	badge = true,
	guide = true,
	formatValue = (v: number) => v.toFixed(2),
}: LiveLineProps) {
	const {
		renderData,
		xScale,
		yScale,
		innerWidth,
		innerHeight,
		xAccessor,
		liveTip,
	} = useChart();
	const reducedMotion = usePrefersReducedMotion();

	const uid = useId();
	const areaGradientId = `live-area-grad-${uid}`;
	const fadeId = `live-fade-${uid}`;
	const fadeMaskId = `live-fade-mask-${uid}`;

	const points: PathPoint[] = renderData.map((d) => {
		const v = d[dataKey];
		return [xScale(xAccessor(d)), yScale(typeof v === "number" ? v : 0)];
	});
	const lineD = monotonePath(points);
	const areaD = areaPathFrom(points, innerHeight);

	const liveDotX = liveTip.x;
	const liveDotY = liveTip.y;
	const badgeLabel = formatValue(liveTip.value);

	return (
		<>
			<defs>
				<linearGradient id={areaGradientId} x1="0" x2="0" y1="0" y2="1">
					<stop offset="0%" stopColor={stroke} stopOpacity={0.1} />
					<stop offset="100%" stopColor={stroke} stopOpacity={0} />
				</linearGradient>
				{/* Trailing-edge fade: white mask brightens where the line shows. */}
				<linearGradient id={fadeId} x1="0" x2="1" y1="0" y2="0">
					<stop offset="0%" stopColor="white" stopOpacity={0} />
					<stop offset="4%" stopColor="white" stopOpacity={1} />
					{liveDotX < innerWidth - 1 ? (
						<>
							<stop
								offset={`${(liveDotX / innerWidth) * 100}%`}
								stopColor="white"
								stopOpacity={1}
							/>
							<stop offset="100%" stopColor="white" stopOpacity={0} />
						</>
					) : (
						<stop offset="100%" stopColor="white" stopOpacity={1} />
					)}
				</linearGradient>
				<mask id={fadeMaskId}>
					<rect
						fill={`url(#${fadeId})`}
						height={innerHeight + 40}
						width={innerWidth}
						x={0}
						y={-20}
					/>
				</mask>
			</defs>

			{/* Area fill */}
			{fill && points.length > 1 && (
				<g mask={`url(#${fadeMaskId})`}>
					<path d={areaD} fill={`url(#${areaGradientId})`} />
				</g>
			)}

			{/* Line */}
			{points.length > 1 && (
				<g mask={`url(#${fadeMaskId})`}>
					<path
						d={lineD}
						fill="none"
						stroke={stroke}
						strokeLinecap="round"
						strokeLinejoin="round"
						strokeWidth={strokeWidth}
					/>
				</g>
			)}

			{/* Dashed horizontal line at current value */}
			{guide && (
				<line
					opacity={0.25}
					stroke={stroke}
					strokeDasharray="4,4"
					strokeWidth={1}
					x1={0}
					x2={innerWidth}
					y1={liveDotY}
					y2={liveDotY}
				/>
			)}

			{/* Live dot */}
			<g>
				{pulse && !reducedMotion && (
					<circle
						cx={liveDotX}
						cy={liveDotY}
						fill="none"
						opacity={0.4}
						r={dotSize * 2}
						stroke={stroke}
						strokeWidth={1.5}
					>
						<animate
							attributeName="r"
							dur="1.5s"
							from={String(dotSize)}
							repeatCount="indefinite"
							to={String(dotSize * 3.5)}
						/>
						<animate
							attributeName="opacity"
							dur="1.5s"
							from="0.5"
							repeatCount="indefinite"
							to="0"
						/>
					</circle>
				)}
				<circle
					cx={liveDotX}
					cy={liveDotY}
					fill={stroke}
					opacity={0.1}
					r={dotSize + 2}
				/>
				<circle
					cx={liveDotX}
					cy={liveDotY}
					fill={stroke}
					r={dotSize}
					stroke="var(--color-kumo-canvas)"
					strokeWidth={2}
				/>
			</g>

			{/* Value badge pill */}
			{badge && (
				<g transform={`translate(${liveDotX + 12},${liveDotY})`}>
					<rect
						fill="var(--color-kumo-overlay)"
						height={24}
						opacity={0.95}
						rx={6}
						width={badgeLabel.length * 7.5 + 16}
						x={0}
						y={-12}
					/>
					<text
						fill="var(--text-color-kumo-default)"
						fontFamily="var(--font-mono)"
						fontSize={11}
						fontWeight={500}
						style={{ fontVariantNumeric: "tabular-nums" }}
						x={8}
						y={4}
					>
						{badgeLabel}
					</text>
				</g>
			)}
		</>
	);
}

LiveLine.displayName = "LiveLine";
