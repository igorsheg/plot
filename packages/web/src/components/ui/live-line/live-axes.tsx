/**
 * SVG axes for the live chart. Labels are SVG text (exempt from the Text
 * component rule): fontSize 10, subtle fill, tabular-nums. Axis lines use
 * the hairline token.
 */

import { useChart } from "./chart-context.js";

const LABEL_FILL = "var(--text-color-kumo-subtle)";
const HAIRLINE = "var(--color-kumo-hairline)";
const LABEL_STYLE = { fontVariantNumeric: "tabular-nums" } as const;

const defaultTimeFormat = new Intl.DateTimeFormat(undefined, {
	hour: "2-digit",
	minute: "2-digit",
	second: "2-digit",
	hour12: false,
});

const defaultFormatTime = (d: Date) => defaultTimeFormat.format(d);

export interface LiveXAxisProps {
	/** Time label formatter. Default: HH:MM:SS. */
	formatTime?: (d: Date) => string;
}

export function LiveXAxis({ formatTime = defaultFormatTime }: LiveXAxisProps) {
	const { xScale, innerWidth, innerHeight, numXTicks } = useChart();
	const [startMs, endMs] = xScale.domain();
	const step = (endMs - startMs) / (numXTicks - 1);
	const ticks = Array.from({ length: numXTicks }, (_, i) => {
		const timeMs = startMs + i * step;
		return { key: i, x: xScale(timeMs), label: formatTime(new Date(timeMs)) };
	});

	return (
		<g>
			<line
				stroke={HAIRLINE}
				x1={0}
				x2={innerWidth}
				y1={innerHeight}
				y2={innerHeight}
			/>
			{ticks.map((tick) => (
				<text
					fill={LABEL_FILL}
					fontSize={10}
					key={tick.key}
					style={LABEL_STYLE}
					textAnchor="middle"
					x={tick.x}
					y={innerHeight + 20}
				>
					{tick.label}
				</text>
			))}
		</g>
	);
}

LiveXAxis.displayName = "LiveXAxis";

export interface LiveYAxisProps {
	/** Which side of the plot to label. Default: "left". */
	position?: "left" | "right";
	/** Value label formatter. */
	formatValue?: (v: number) => string;
	/** Tick count hint. Default: 4. */
	ticks?: number;
}

export function LiveYAxis({
	position = "left",
	formatValue = (v: number) => v.toFixed(2),
	ticks = 4,
}: LiveYAxisProps) {
	const { yScale, innerWidth, innerHeight } = useChart();
	const isLeft = position === "left";
	const lineX = isLeft ? 0 : innerWidth;
	const labelX = isLeft ? 4 : innerWidth - 4;
	const values = yScale
		.ticks(ticks)
		.map((value) => ({ value, y: yScale(value) }))
		.filter((tick) => tick.y >= 0 && tick.y <= innerHeight);

	return (
		<g>
			<line stroke={HAIRLINE} x1={lineX} x2={lineX} y1={0} y2={innerHeight} />
			{values.map((tick) => (
				<text
					dy={-4}
					fill={LABEL_FILL}
					fontSize={10}
					key={tick.value}
					style={LABEL_STYLE}
					textAnchor={isLeft ? "start" : "end"}
					x={labelX}
					y={tick.y}
				>
					{formatValue(tick.value)}
				</text>
			))}
		</g>
	);
}

LiveYAxis.displayName = "LiveYAxis";
