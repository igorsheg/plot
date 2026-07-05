import { createContext, use, useMemo } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "./components/ui/empty.js";
import { Dot } from "./components/ui/dot.js";
import { ScrollArea } from "./components/ui/scroll-area.js";
import { Skeleton } from "./components/ui/skeleton.js";
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
import { useSession } from "./session-context.js";
import { useHeartbeat } from "./use-heartbeat.js";
import { workItemHref } from "./work-card.js";

interface TimelineContextValue {
	readonly state: {
		readonly live: boolean;
		readonly model: TimelineModel | undefined;
		readonly nowMs: number;
		readonly nowPct: number;
	};
}

const TimelineContext = createContext<TimelineContextValue | null>(null);

const useTimeline = (): TimelineContextValue => {
	const value = use(TimelineContext);
	if (value === null) throw new Error("Timeline part outside TimelineProvider");
	return value;
};

const isRunLive = (status: string): boolean =>
	status === "online" || status === "running";

const toPct = (
	atMs: number,
	domainStartMs: number,
	domainEndMs: number,
): number =>
	Math.min(
		100,
		Math.max(0, ((atMs - domainStartMs) / (domainEndMs - domainStartMs)) * 100),
	);

const leftStyle = (left: number): CSSProperties => ({ left: `${left}%` });

const leftWidthStyle = (left: number, width: number): CSSProperties => ({
	left: `${left}%`,
	width: `${width}%`,
});

function TimelineProvider({ children }: { readonly children: ReactNode }) {
	useHeartbeat();
	const { state } = useSession();
	const live = isRunLive(state.run.status);
	const nowMs = Date.now();
	const model = useMemo(() => {
		if (state.projection === undefined) return undefined;
		return deriveTimeline(state.projection, nowMs, live);
	}, [state.projection, live, nowMs]);
	const nowPct =
		model === undefined
			? 0
			: toPct(nowMs, model.domainStartMs, model.domainEndMs);
	return (
		<TimelineContext value={{ state: { live, model, nowMs, nowPct } }}>
			{children}
		</TimelineContext>
	);
}

function Frame({ children }: { readonly children: ReactNode }) {
	return (
		<ScrollArea className="min-h-0 min-w-0 flex-1" fill>
			<div className="w-full px-4 py-4">{children}</div>
		</ScrollArea>
	);
}

function Loading() {
	return (
		<div className="space-y-2">
			{[0, 1, 2].map((index) => (
				<Skeleton key={index} className="h-7 w-full rounded-md" />
			))}
		</div>
	);
}

function EmptyTimeline() {
	return (
		<Empty>
			<EmptyHeader>
				<EmptyTitle>No activity recorded yet.</EmptyTitle>
				<EmptyDescription>
					Attempts and scheduled wakes draw here as the session works.
				</EmptyDescription>
			</EmptyHeader>
		</Empty>
	);
}

function TrackChrome() {
	const {
		state: { live, nowPct },
	} = useTimeline();
	if (!live) return null;
	return (
		<>
			{nowPct < 100 && (
				<div
					aria-hidden
					className="absolute inset-y-0 bg-muted/20"
					style={leftWidthStyle(nowPct, 100 - nowPct)}
				/>
			)}
			<div
				aria-hidden
				className="absolute inset-y-0 w-px bg-foreground/20"
				style={leftStyle(nowPct)}
			/>
		</>
	);
}

function Axis() {
	const {
		state: { live, model, nowMs },
	} = useTimeline();
	if (model === undefined) return null;
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
		<div className="flex items-end gap-3 border-b pb-2">
			<div className="w-56 shrink-0" />
			<div className="relative h-6 flex-1 font-mono text-xs tabular-nums text-muted-foreground">
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
						{tick.label}
					</span>
				))}
			</div>
		</div>
	);
}

const endLabel = (
	domainStartMs: number,
	domainEndMs: number,
	nowMs: number,
): string => {
	// SPEC-GAP: "domainEnd ≈ now" has no threshold; the 3% padding counts as now.
	const paddedNowMs = nowMs + (domainEndMs - domainStartMs) * 0.031;
	return domainEndMs <= paddedNowMs
		? "now"
		: `+${formatDuration(domainEndMs - nowMs)}`;
};

const spanToneClass: Record<TimelineSpan["tone"], string> = {
	success: "bg-success/60 hover:bg-success",
	failed: "bg-destructive/60 hover:bg-destructive",
	running: "bg-info/60 hover:bg-info",
};

const markToneClass: Record<TimelineMark["kind"], string> = {
	wake: "border-muted-foreground/60",
	retry: "border-warning bg-warning/20",
};

function spanStyle(
	span: TimelineSpan,
	domainStartMs: number,
	domainEndMs: number,
): CSSProperties {
	const start = toPct(span.startMs, domainStartMs, domainEndMs);
	const end = toPct(span.endMs, domainStartMs, domainEndMs);
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
	} = useTimeline();
	if (model === undefined) return null;
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<a
						aria-label={`${title}: ${span.label}`}
						className={cn(
							"absolute top-1/2 h-2.5 -translate-y-1/2 rounded-full",
							spanToneClass[span.tone],
						)}
						href={workItemHref(workKey)}
						style={spanStyle(span, model.domainStartMs, model.domainEndMs)}
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
	} = useTimeline();
	if (model === undefined) return null;
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

function Session() {
	const {
		state: { model },
	} = useTimeline();
	if (model === undefined || model.sessionMarks.length === 0) return null;
	return (
		<div className="flex h-7 items-center gap-3 border-b border-border/40">
			<div className="w-56 shrink-0" />
			<div className="relative h-full flex-1">
				<TrackChrome />
				{model.sessionMarks.map((mark, index) => (
					<MarkDiamond key={`${mark.atMs}:${index}`} mark={mark} />
				))}
			</div>
		</div>
	);
}

function Rows() {
	const {
		state: { model },
	} = useTimeline();
	if (model === undefined) return null;
	const shown = model.rows.slice(0, 40);
	const overflow = model.rows.length - shown.length;
	return (
		<div className="divide-y divide-border/40">
			{shown.map((row) => (
				<div key={row.workKey} className="flex h-7 items-center gap-3">
					<div className="flex w-56 shrink-0 items-center gap-2 pr-3">
						{row.running && <Dot className="animate-pulse bg-success" />}
						<a
							className="min-w-0 truncate text-sm hover:underline"
							href={workItemHref(row.workKey)}
						>
							{row.title}
						</a>
					</div>
					<div className="relative h-full flex-1">
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
				</div>
			))}
			{overflow > 0 && (
				<p className="py-2 text-xs text-muted-foreground">+ {overflow} more</p>
			)}
		</div>
	);
}

const Timeline = {
	Frame,
	Axis,
	Session,
	Rows,
};

function TimelineBody() {
	const {
		state: { model },
	} = useTimeline();
	if (model === undefined) return <Loading />;
	if (model.rows.length === 0 && model.sessionMarks.length === 0)
		return <EmptyTimeline />;
	return (
		<div className="space-y-0">
			<Timeline.Axis />
			<Timeline.Session />
			<Timeline.Rows />
		</div>
	);
}

export function SessionTimeline() {
	return (
		<TimelineProvider>
			<Timeline.Frame>
				<TimelineBody />
			</Timeline.Frame>
		</TimelineProvider>
	);
}
