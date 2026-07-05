import { createContext, use, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent, ReactNode } from "react";
import {
	Tooltip,
	TooltipPopup,
	TooltipTrigger,
} from "./components/ui/tooltip.js";
import {
	deriveTimeline,
	type TimelineMark,
	type TimelineModel,
	type TimelineSpan,
} from "./derive-timeline.js";
import { formatAgo, formatDuration } from "./format.js";
import { cn } from "./lib/utils.js";
import { loadReplayLog, projectionAt, type ReplayLog } from "./replay.js";
import { useSession } from "./session-context.js";
import { useNow } from "./use-countdown.js";
import { workItemHref } from "./work-card.js";

interface FloorContextValue {
	readonly state: {
		readonly dragging: boolean;
		readonly live: boolean;
		readonly model: TimelineModel;
		readonly playheadPct: number;
	};
	readonly actions: {
		readonly onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
		readonly onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
		readonly onPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
	};
}

const FloorContext = createContext<FloorContextValue | null>(null);

const useFloor = (): FloorContextValue => {
	const value = use(FloorContext);
	if (value === null) throw new Error("Floor part outside FloorProvider");
	return value;
};

const isRunLive = (status: string): boolean =>
	status === "online" || status === "running";

const toPct = (
	atMs: number,
	domainStartMs: number,
	domainEndMs: number,
): number =>
	domainEndMs <= domainStartMs
		? 100
		: Math.min(
				100,
				Math.max(
					0,
					((atMs - domainStartMs) / (domainEndMs - domainStartMs)) * 100,
				),
			);

const leftStyle = (left: number): CSSProperties => ({ left: `${left}%` });

const leftWidthStyle = (left: number, width: number): CSSProperties => ({
	left: `${left}%`,
	width: `${width}%`,
});

const atPct = (pct: number, model: TimelineModel): number =>
	model.domainStartMs + ((model.domainEndMs - model.domainStartMs) * pct) / 100;

const pointerPct = (event: PointerEvent<HTMLDivElement>): number => {
	const rect = event.currentTarget.getBoundingClientRect();
	return Math.min(
		100,
		Math.max(0, ((event.clientX - rect.left) / rect.width) * 100),
	);
};

function FloorProvider({ children }: { readonly children: ReactNode }) {
	const session = useSession();
	const nowMs = useNow();
	const baseProjection =
		session.state.liveProjection ?? session.state.projection;
	const live = isRunLive(session.state.run.status);
	const model = useMemo(() => {
		if (baseProjection === undefined) return undefined;
		return deriveTimeline(
			live ? baseProjection : { ...baseProjection, scheduledWakes: [] },
			nowMs,
			live,
		);
	}, [baseProjection, live, nowMs]);
	const [dragging, setDragging] = useState(false);
	const replayLogRef = useRef<ReplayLog | undefined>(undefined);
	const replayPromiseRef = useRef<Promise<void> | undefined>(undefined);
	if (model === undefined || baseProjection === undefined) return null;
	const ensureReplay = () => {
		if (
			replayLogRef.current !== undefined ||
			replayPromiseRef.current !== undefined
		)
			return;
		replayPromiseRef.current = loadReplayLog(
			session.state.run.id,
			baseProjection,
		).then((log) => {
			replayLogRef.current = log;
			replayPromiseRef.current = undefined;
			if (session.state.playheadMs !== undefined)
				scrubTo(session.state.playheadMs);
			return undefined;
		});
	};
	const scrubTo = (playheadMs: number) => {
		const log = replayLogRef.current;
		if (log === undefined || log.events.length === 0) {
			session.actions.scrubTo({ playheadMs, projection: baseProjection });
			return;
		}
		const point = projectionAt(log, playheadMs);
		session.actions.scrubTo(point);
	};
	const updateFromEvent = (event: PointerEvent<HTMLDivElement>) => {
		scrubTo(atPct(pointerPct(event), model));
	};
	const parkedMs = live ? nowMs : model.domainEndMs;
	const playheadPct = toPct(
		session.state.playheadMs ?? parkedMs,
		model.domainStartMs,
		model.domainEndMs,
	);
	return (
		<FloorContext
			value={{
				state: { dragging, live, model, playheadPct },
				actions: {
					onPointerDown: (event) => {
						event.preventDefault();
						event.currentTarget.setPointerCapture(event.pointerId);
						setDragging(true);
						ensureReplay();
						updateFromEvent(event);
					},
					onPointerMove: (event) => {
						if (!dragging) return;
						updateFromEvent(event);
					},
					onPointerUp: (event) => {
						if (event.currentTarget.hasPointerCapture(event.pointerId))
							event.currentTarget.releasePointerCapture(event.pointerId);
						setDragging(false);
						session.actions.endScrub();
					},
				},
			}}
		>
			{children}
		</FloorContext>
	);
}

function TrackChrome() {
	const {
		state: { live, playheadPct },
	} = useFloor();
	return (
		<>
			{live && playheadPct < 100 && (
				<div
					aria-hidden
					className="absolute inset-y-0 bg-muted/20"
					style={leftWidthStyle(playheadPct, 100 - playheadPct)}
				/>
			)}
			<div
				aria-hidden
				className="floor-playhead-line absolute inset-y-0 w-px bg-foreground/30"
				style={leftStyle(playheadPct)}
			/>
		</>
	);
}

const endLabel = (
	domainStartMs: number,
	domainEndMs: number,
	nowMs: number,
): string => {
	const paddedNowMs = nowMs + (domainEndMs - domainStartMs) * 0.031;
	return domainEndMs <= paddedNowMs
		? "now"
		: `+${formatDuration(domainEndMs - nowMs)}`;
};

function Axis() {
	const {
		state: { live, model },
	} = useFloor();
	const nowMs = useNow();
	const rangeMs = model.domainEndMs - model.domainStartMs;
	const ticks = [0, 1, 2, 3].map((index) => {
		const atMs = model.domainStartMs + (rangeMs * index) / 3;
		return {
			atMs,
			left: (index * 100) / 3,
			label:
				index === 3
					? live
						? endLabel(model.domainStartMs, model.domainEndMs, nowMs)
						: `${formatAgo(model.domainEndMs)} ago`
					: `${formatAgo(atMs)} ago`,
		};
	});
	return (
		<div className="relative h-5 font-mono text-xs tabular-nums text-muted-foreground">
			<TrackChrome />
			{ticks.map((tick, index) => (
				<span
					key={tick.atMs}
					className={cn(
						"absolute bottom-0 whitespace-nowrap",
						index === 0
							? ""
							: index === ticks.length - 1
								? "-translate-x-full"
								: "-translate-x-1/2",
					)}
					style={leftStyle(tick.left)}
				>
					{index === 0 || tick.label !== ticks[index - 1]?.label
						? tick.label
						: ""}
				</span>
			))}
		</div>
	);
}

const spanToneClass: Record<TimelineSpan["tone"], string> = {
	success: "bg-success/60 hover:bg-success",
	failed: "bg-destructive/60 hover:bg-destructive",
	running: "bg-info/60 hover:bg-info",
};

const markToneClass: Record<TimelineMark["kind"], string> = {
	wake: "border-muted-foreground/60",
	retry: "border-warning bg-warning/20",
};

function spanStyle(span: TimelineSpan, model: TimelineModel): CSSProperties {
	const start = toPct(span.startMs, model.domainStartMs, model.domainEndMs);
	const end = toPct(span.endMs, model.domainStartMs, model.domainEndMs);
	const width = Math.max(0.4, end - start);
	return leftWidthStyle(Math.min(start, 100 - width), width);
}

function SpanBar({
	span,
	title,
	workKey,
}: {
	readonly span: TimelineSpan;
	readonly title: string;
	readonly workKey: string;
}) {
	const {
		state: { model },
	} = useFloor();
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<a
						aria-label={`${title}: ${span.label}`}
						className={cn(
							"absolute top-1/2 h-2 -translate-y-1/2 rounded-full",
							spanToneClass[span.tone],
						)}
						href={workItemHref(workKey)}
						style={spanStyle(span, model)}
					/>
				}
			>
				{span.tone === "running" && (
					<span
						aria-hidden
						className="absolute top-1/2 right-0 size-1.5 -translate-y-1/2 animate-pulse rounded-full bg-info"
					/>
				)}
			</TooltipTrigger>
			<TooltipPopup>{span.label}</TooltipPopup>
		</Tooltip>
	);
}

function MarkDiamond({ mark }: { readonly mark: TimelineMark }) {
	const {
		state: { model },
	} = useFloor();
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<div
						aria-label={mark.label}
						className={cn(
							"absolute top-1/2 size-2 -translate-y-1/2 rotate-45 border",
							markToneClass[mark.kind],
						)}
						role="img"
						style={leftStyle(
							toPct(mark.atMs, model.domainStartMs, model.domainEndMs),
						)}
					/>
				}
			/>
			<TooltipPopup>{mark.label}</TooltipPopup>
		</Tooltip>
	);
}

function SessionMarks() {
	const {
		state: { model },
	} = useFloor();
	if (model.sessionMarks.length === 0) return null;
	return (
		<div className="relative h-3 border-t border-border/40">
			<TrackChrome />
			{model.sessionMarks.map((mark, index) => (
				<MarkDiamond key={`${mark.atMs}:${index}`} mark={mark} />
			))}
		</div>
	);
}

function Rows() {
	const {
		state: { model },
	} = useFloor();
	const rows = model.rows
		.toSorted((left, right) => right.lastActivityMs - left.lastActivityMs)
		.slice(0, 12);
	return (
		<div className="divide-y divide-border/40">
			{rows.map((row) => (
				<div key={row.workKey} className="relative h-3" title={row.title}>
					<TrackChrome />
					{row.spans.map((span, index) => (
						<SpanBar
							key={`${span.startMs}:${span.endMs}:${index}`}
							span={span}
							title={row.title}
							workKey={row.workKey}
						/>
					))}
					{row.marks.map((mark, index) => (
						<MarkDiamond key={`${mark.atMs}:${index}`} mark={mark} />
					))}
				</div>
			))}
		</div>
	);
}

function Playhead() {
	const session = useSession();
	const {
		state: { dragging, playheadPct },
		actions,
	} = useFloor();
	return (
		<div
			className="absolute inset-0"
			data-dragging={dragging ? "true" : "false"}
			onPointerDown={actions.onPointerDown}
			onPointerMove={actions.onPointerMove}
			onPointerCancel={actions.onPointerUp}
			onPointerUp={actions.onPointerUp}
		>
			{session.state.playheadMs !== undefined && (
				<div
					className="floor-playhead-chip absolute top-0 -translate-x-1/2 whitespace-nowrap rounded border bg-background px-1.5 py-0.5 font-mono text-xs tabular-nums shadow-sm"
					style={leftStyle(playheadPct)}
				>
					{session.state.historyTruncated
						? "history truncated"
						: `${formatAgo(session.state.playheadMs)} ago`}
				</div>
			)}
			<div
				aria-label="timeline playhead"
				className="floor-playhead-grabber absolute top-0 bottom-0 w-4 -translate-x-1/2 cursor-ew-resize"
				role="slider"
				style={leftStyle(playheadPct)}
			/>
		</div>
	);
}

function FloorBody() {
	const {
		state: { live, model },
	} = useFloor();
	if (!live && model.rows.length === 0 && model.sessionMarks.length === 0)
		return null;
	return (
		<div className="relative h-36 border-t bg-background px-6 py-3">
			<div className="relative mx-auto h-full w-full max-w-2xl space-y-1">
				<Axis />
				<SessionMarks />
				<Rows />
				<Playhead />
			</div>
		</div>
	);
}

export function Floor() {
	return (
		<FloorProvider>
			<FloorBody />
		</FloorProvider>
	);
}
