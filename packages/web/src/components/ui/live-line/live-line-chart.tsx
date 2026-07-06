/**
 * Chart root: container sizing, the lerped rAF animation loop, scale
 * construction, and the context provider. Children compose everything else.
 */

import {
	Children,
	isValidElement,
	memo,
	type ReactNode,
	startTransition,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { cn } from "../../../lib/utils.js";
import {
	ChartContext,
	type ChartContextValue,
	type LineConfig,
	type Margin,
} from "./chart-context.js";
import type { LiveLineProps } from "./live-line.js";
import {
	buildRenderData,
	computeTargetRange,
	type LiveLinePoint,
	makeLinearScale,
	makeTimeScale,
	type RenderDatum,
} from "./scale.js";
import { useParentSize, usePrefersReducedMotion } from "./use-parent-size.js";

const LERP_SPEED = 0.08;
const DEFAULT_MARGIN: Margin = { top: 24, right: 16, bottom: 32, left: 16 };
/** React commit interval for the live animation loop (~30fps). */
const LIVE_FRAME_COMMIT_MS = 32;
const DEFAULT_STROKE = "var(--color-kumo-info)";

export interface LiveLineChartProps {
	/** Streaming data — array of { time: unixSeconds, value }. */
	data: readonly LiveLinePoint[];
	/** Latest value (smoothly interpolated to). */
	value: number;
	/** Key used for the value field in render data. Default: "value". */
	dataKey?: string;
	/** Visible time window in seconds. Default: 30. */
	window?: number;
	/** Number of X-axis ticks (also sets the leading unit). Default: 5. */
	numXTicks?: number;
	/** Leading offset in X-tick units (0 = now at right edge). Default: 0. */
	nowOffsetUnits?: number;
	/** Tight Y-axis padding. Default: false. */
	exaggerate?: boolean;
	/** Interpolation speed (0–1). Default: 0.08. */
	lerpSpeed?: number;
	/** Chart margins. */
	margin?: Partial<Margin>;
	/** Freeze chart scrolling. Default: false. */
	paused?: boolean;
	className?: string;
	/** Container height defaults to 300 via style; override here. */
	style?: React.CSSProperties;
	children: ReactNode;
}

interface AnimFrame {
	now: number;
	yMin: number;
	yMax: number;
	displayValue: number;
}

/** y-min snaps down instantly, decays up; y-max snaps up, decays down. */
function nextAnimFrame(
	prev: AnimFrame,
	targetRange: { yMin: number; yMax: number },
	targetValue: number,
	speed: number,
	isPaused: boolean,
): AnimFrame {
	const nextNow = isPaused ? prev.now : Date.now();
	const nextYMin =
		targetRange.yMin < prev.yMin
			? targetRange.yMin
			: prev.yMin + (targetRange.yMin - prev.yMin) * speed;
	const nextYMax =
		targetRange.yMax > prev.yMax
			? targetRange.yMax
			: prev.yMax + (targetRange.yMax - prev.yMax) * speed;
	const nextValue =
		prev.displayValue + (targetValue - prev.displayValue) * speed;
	return {
		now: nextNow,
		yMin: nextYMin,
		yMax: nextYMax,
		displayValue: nextValue,
	};
}

function extractLiveLineConfigs(children: ReactNode): LineConfig[] {
	const configs: LineConfig[] = [];
	Children.forEach(children, (child) => {
		if (!isValidElement(child)) {
			return;
		}
		const childType = child.type as { displayName?: string; name?: string };
		const name =
			typeof child.type === "function"
				? childType.displayName || childType.name || ""
				: "";
		const props = child.props as Partial<LiveLineProps> | undefined;
		if (
			(name === "LiveLine" || (props !== undefined && "dataKey" in props)) &&
			props?.dataKey
		) {
			configs.push({
				dataKey: props.dataKey,
				stroke: props.stroke || DEFAULT_STROKE,
				strokeWidth: props.strokeWidth || 2,
			});
		}
	});
	return configs;
}

interface CoreProps {
	data: readonly LiveLinePoint[];
	value: number;
	dataKey: string;
	windowSecs: number;
	numXTicks: number;
	nowOffsetUnits: number;
	exaggerate: boolean;
	lerpSpeed: number;
	margin: Margin;
	paused: boolean;
	width: number;
	height: number;
	children: ReactNode;
}

const LiveLineChartCore = memo(function LiveLineChartCore({
	data,
	value,
	dataKey,
	windowSecs,
	numXTicks,
	nowOffsetUnits,
	exaggerate,
	lerpSpeed,
	margin,
	paused,
	width,
	height,
	children,
}: CoreProps) {
	const windowMs = windowSecs * 1000;
	const innerWidth = width - margin.left - margin.right;
	const innerHeight = height - margin.top - margin.bottom;
	const reducedMotion = usePrefersReducedMotion();

	// ---- Animation state ----
	const [frame, setFrame] = useState<AnimFrame>(() => ({
		now: Date.now(),
		yMin: 0,
		yMax: 100,
		displayValue: value,
	}));
	const animRef = useRef<AnimFrame>(frame);
	const pausedRef = useRef(paused);
	pausedRef.current = paused;

	const targetRange = useMemo(
		() => computeTargetRange(data, value, exaggerate),
		[data, value, exaggerate],
	);

	useEffect(() => {
		if (reducedMotion) {
			// One static frame at target values; re-runs on data/value change.
			const still: AnimFrame = {
				now: Date.now(),
				yMin: targetRange.yMin,
				yMax: targetRange.yMax,
				displayValue: value,
			};
			animRef.current = still;
			setFrame(still);
			return;
		}
		let raf = 0;
		let lastCommit = 0;
		const tick = () => {
			const next = nextAnimFrame(
				animRef.current,
				targetRange,
				value,
				lerpSpeed,
				pausedRef.current,
			);
			animRef.current = next;
			const now = performance.now();
			if (now - lastCommit >= LIVE_FRAME_COMMIT_MS) {
				lastCommit = now;
				startTransition(() => setFrame(next));
			}
			raf = requestAnimationFrame(tick);
		};
		const onVisibility = () => {
			cancelAnimationFrame(raf);
			if (!document.hidden) {
				raf = requestAnimationFrame(tick);
			}
		};
		document.addEventListener("visibilitychange", onVisibility);
		if (!document.hidden) {
			raf = requestAnimationFrame(tick);
		}
		return () => {
			cancelAnimationFrame(raf);
			document.removeEventListener("visibilitychange", onVisibility);
		};
	}, [targetRange, value, lerpSpeed, reducedMotion]);

	// ---- Scales and render data ----
	const xTickUnitMs = windowMs / (numXTicks - 1);
	const leadingMs = nowOffsetUnits * xTickUnitMs;
	const domainEndMs = frame.now + leadingMs;

	const xScale = useMemo(
		() => makeTimeScale([domainEndMs - windowMs, domainEndMs], [0, innerWidth]),
		[domainEndMs, windowMs, innerWidth],
	);

	const yScale = useMemo(
		() =>
			makeLinearScale([frame.yMin, frame.yMax], [innerHeight, 0], {
				nice: true,
			}),
		[frame.yMin, frame.yMax, innerHeight],
	);

	const renderData = useMemo(
		() =>
			buildRenderData(data, dataKey, {
				windowStartMs: domainEndMs - windowMs,
				nowMs: frame.now,
				xTickUnitMs,
				displayValue: frame.displayValue,
			}),
		[
			data,
			dataKey,
			domainEndMs,
			windowMs,
			frame.now,
			frame.displayValue,
			xTickUnitMs,
		],
	);

	const lines = useMemo(() => extractLiveLineConfigs(children), [children]);

	const contextValue = useMemo<ChartContextValue>(
		() => ({
			renderData,
			xScale,
			yScale,
			innerWidth,
			innerHeight,
			margin,
			xAccessor: (d: RenderDatum) => d.time,
			lines,
			liveTip: {
				x: xScale(frame.now),
				y: yScale(frame.displayValue),
				value: frame.displayValue,
			},
			numXTicks,
		}),
		[
			renderData,
			xScale,
			yScale,
			innerWidth,
			innerHeight,
			margin,
			lines,
			frame.now,
			frame.displayValue,
			numXTicks,
		],
	);

	return (
		<ChartContext value={contextValue}>
			<svg
				aria-hidden="true"
				height={height}
				style={{ display: "block", overflow: "visible" }}
				width={width}
			>
				<g transform={`translate(${margin.left},${margin.top})`}>{children}</g>
			</svg>
		</ChartContext>
	);
});

export function LiveLineChart({
	data,
	value,
	dataKey = "value",
	window: windowSecs = 30,
	numXTicks = 5,
	nowOffsetUnits = 0,
	exaggerate = false,
	lerpSpeed = LERP_SPEED,
	margin: marginProp,
	paused = false,
	className,
	style,
	children,
}: LiveLineChartProps) {
	const { ref, width, height } = useParentSize();
	const margin = useMemo(
		() => ({ ...DEFAULT_MARGIN, ...marginProp }),
		[marginProp],
	);
	const innerWidth = width - margin.left - margin.right;
	const innerHeight = height - margin.top - margin.bottom;

	return (
		<div
			className={cn("relative w-full", className)}
			ref={ref}
			style={{ height: 300, ...style }}
		>
			{innerWidth > 0 && innerHeight > 0 ? (
				<LiveLineChartCore
					data={data}
					dataKey={dataKey}
					exaggerate={exaggerate}
					height={height}
					lerpSpeed={lerpSpeed}
					margin={margin}
					nowOffsetUnits={nowOffsetUnits}
					numXTicks={numXTicks}
					paused={paused}
					value={value}
					width={width}
					windowSecs={windowSecs}
				>
					{children}
				</LiveLineChartCore>
			) : null}
		</div>
	);
}

LiveLineChart.displayName = "LiveLineChart";
