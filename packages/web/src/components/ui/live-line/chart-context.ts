/**
 * Internal chart context. UI children (LiveLine, LiveXAxis, LiveYAxis)
 * depend only on this plain interface — never on the chart root's internals.
 * Not exported from index.ts.
 */

import { createContext, use } from "react";
import type { LinearScale, RenderDatum, TimeScale } from "./scale.js";

export interface Margin {
	top: number;
	right: number;
	bottom: number;
	left: number;
}

export interface LineConfig {
	dataKey: string;
	stroke: string;
	strokeWidth: number;
}

export interface LiveTip {
	x: number;
	y: number;
	value: number;
}

export interface ChartContextValue {
	renderData: RenderDatum[];
	xScale: TimeScale;
	yScale: LinearScale;
	innerWidth: number;
	innerHeight: number;
	margin: Margin;
	xAccessor: (d: RenderDatum) => number;
	lines: LineConfig[];
	liveTip: LiveTip;
	/** X tick count owned by the chart root; axes render, they don't decide. */
	numXTicks: number;
}

export const ChartContext = createContext<ChartContextValue | null>(null);

export function useChart(): ChartContextValue {
	const context = use(ChartContext);
	if (context === null) {
		throw new Error(
			"Live line chart components must be rendered inside <LiveLineChart>.",
		);
	}
	return context;
}
