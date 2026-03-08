import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { DateTime } from "effect";
import { motion, AnimatePresence } from "motion/react";
import type { AgentRuntimeEvent } from "@plot/sdk";
import {
	groupEventsByTurn,
	dedupNotifications,
	eventLabel,
	eventColor,
	relativeTimestamp,
	type TurnGroup,
} from "@plot/sdk";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type ViewMode = "grouped" | "raw";

interface TraceViewerProps {
	events: ReadonlyArray<AgentRuntimeEvent>;
	selectedEventIndex: number | null;
	onSelectEvent: (index: number) => void;
}

const FADE_INITIAL = { opacity: 0, y: 4 };
const FADE_ANIMATE = { opacity: 1, y: 0 };
const FADE_EXIT = { opacity: 0, y: -4 };
const FADE_TRANSITION = { duration: 0.15 };

function useStickToBottom(count: number) {
	const containerRef = useRef<HTMLDivElement>(null);
	const stuckRef = useRef(true);

	useEffect(() => {
		const el = containerRef.current;
		if (!el) return;

		const handleScroll = () => {
			const threshold = 40;
			stuckRef.current =
				el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
		};

		el.addEventListener("scroll", handleScroll, { passive: true });
		return () => el.removeEventListener("scroll", handleScroll);
	}, []);

	useEffect(() => {
		const el = containerRef.current;
		if (!el || !stuckRef.current) return;
		el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
	}, [count]);

	return containerRef;
}

function TreeConnector({ isLast }: { isLast: boolean }) {
	return (
		<span
			className={cn(
				"inline-block w-4 shrink-0 border-l border-border text-border",
				isLast ? "rounded-bl border-b" : "",
			)}
			aria-hidden
		>
			{isLast ? "└" : "├"}
		</span>
	);
}

function PulseDot({ active }: { active: boolean }) {
	if (!active) return null;
	return (
		<span className="relative flex size-2 shrink-0">
			<span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />
			<span className="relative inline-flex size-2 rounded-full bg-success" />
		</span>
	);
}

function EventRow({
	event,
	index,
	origin,
	isSelected,
	onSelect,
	isChild,
	isLastChild,
}: {
	event: AgentRuntimeEvent;
	index: number;
	origin: DateTime.Utc;
	isSelected: boolean;
	onSelect: (index: number) => void;
	isChild: boolean;
	isLastChild: boolean;
}) {
	const handleClick = useCallback(() => onSelect(index), [onSelect, index]);

	return (
		<button
			type="button"
			className={cn(
				"flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-accent/40",
				isSelected && "bg-accent/60",
			)}
			onClick={handleClick}
		>
			{isChild && <TreeConnector isLast={isLastChild} />}
			<span className={cn("shrink-0 font-medium", eventColor(event.event))}>
				{eventLabel(event.event)}
			</span>
			{event.message && (
				<span className="min-w-0 flex-1 truncate text-muted-foreground">
					{event.message}
				</span>
			)}
			<span className="shrink-0 font-mono text-muted-foreground">
				{relativeTimestamp(event, origin)}
			</span>
		</button>
	);
}

function TurnGroupRow({
	group,
	origin,
	globalIndexOffset,
	selectedEventIndex,
	onSelectEvent,
}: {
	group: TurnGroup;
	origin: DateTime.Utc;
	globalIndexOffset: number;
	selectedEventIndex: number | null;
	onSelectEvent: (index: number) => void;
}) {
	const durationLabel =
		group.durationMs !== null
			? `${(group.durationMs / 1000).toFixed(1)}s`
			: "in progress";

	return (
		<motion.div
			initial={FADE_INITIAL}
			animate={FADE_ANIMATE}
			exit={FADE_EXIT}
			transition={FADE_TRANSITION}
			className="border-b border-border last:border-b-0"
		>
			<div className="flex items-center gap-2 px-3 py-2">
				<PulseDot active={group.isActive} />
				<span className="type-meta font-medium">
					turn {group.turnIndex + 1}
				</span>
				<Badge variant={group.isActive ? "default" : "outline"} size="sm">
					{durationLabel}
				</Badge>
				<span className="type-meta ml-auto font-mono">
					{relativeTimestamp(group.events[0]!, origin)}
				</span>
			</div>
			<div className="pb-1 pl-2">
				{group.events.map((event, i) => (
					<EventRow
						key={`${event.event}-${Number(DateTime.toEpochMillis(event.timestamp))}`}
						event={event}
						index={globalIndexOffset + i}
						origin={origin}
						isSelected={selectedEventIndex === globalIndexOffset + i}
						onSelect={onSelectEvent}
						isChild
						isLastChild={i === group.events.length - 1}
					/>
				))}
			</div>
		</motion.div>
	);
}

function RawEventList({
	events,
	origin,
	selectedEventIndex,
	onSelectEvent,
}: {
	events: ReadonlyArray<AgentRuntimeEvent>;
	origin: DateTime.Utc;
	selectedEventIndex: number | null;
	onSelectEvent: (index: number) => void;
}) {
	return (
		<AnimatePresence mode="popLayout">
			{events.map((event, i) => (
				<motion.div
					key={`${event.event}-${Number(DateTime.toEpochMillis(event.timestamp))}`}
					initial={FADE_INITIAL}
					animate={FADE_ANIMATE}
					exit={FADE_EXIT}
					transition={FADE_TRANSITION}
					className="border-b border-border last:border-b-0"
				>
					<EventRow
						event={event}
						index={i}
						origin={origin}
						isSelected={selectedEventIndex === i}
						onSelect={onSelectEvent}
						isChild={false}
						isLastChild={false}
					/>
				</motion.div>
			))}
		</AnimatePresence>
	);
}

function GroupedEventList({
	events,
	origin,
	selectedEventIndex,
	onSelectEvent,
}: {
	events: ReadonlyArray<AgentRuntimeEvent>;
	origin: DateTime.Utc;
	selectedEventIndex: number | null;
	onSelectEvent: (index: number) => void;
}) {
	const groups = groupEventsByTurn(events);
	let offset = 0;

	return (
		<AnimatePresence mode="popLayout">
			{groups.map((group) => {
				const currentOffset = offset;
				offset += group.events.length;
				return (
					<TurnGroupRow
						key={group.turnIndex}
						group={group}
						origin={origin}
						globalIndexOffset={currentOffset}
						selectedEventIndex={selectedEventIndex}
						onSelectEvent={onSelectEvent}
					/>
				);
			})}
		</AnimatePresence>
	);
}

export function TraceViewer({
	events,
	selectedEventIndex,
	onSelectEvent,
}: TraceViewerProps) {
	const [mode, setMode] = useState<ViewMode>("grouped");
	const deduped = useMemo(() => dedupNotifications(events), [events]);
	const origin =
		deduped.length > 0 ? deduped[0]!.timestamp : DateTime.unsafeMake(0);
	const containerRef = useStickToBottom(deduped.length);

	const selectGrouped = useCallback(() => setMode("grouped"), []);
	const selectRaw = useCallback(() => setMode("raw"), []);

	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center justify-between">
				<p className="type-meta">event trace</p>
				<div className="cluster-shell">
					<button
						type="button"
						className={cn(
							"rounded px-2 py-0.5 text-xs transition-colors",
							mode === "grouped"
								? "bg-accent text-foreground"
								: "text-muted-foreground hover:text-foreground",
						)}
						onClick={selectGrouped}
					>
						grouped
					</button>
					<button
						type="button"
						className={cn(
							"rounded px-2 py-0.5 text-xs transition-colors",
							mode === "raw"
								? "bg-accent text-foreground"
								: "text-muted-foreground hover:text-foreground",
						)}
						onClick={selectRaw}
					>
						raw
					</button>
				</div>
			</div>

			<div ref={containerRef} className="panel-shell max-h-80 overflow-y-auto">
				{deduped.length === 0 ? (
					<p className="type-meta p-4">no events yet</p>
				) : mode === "grouped" ? (
					<GroupedEventList
						events={deduped}
						origin={origin}
						selectedEventIndex={selectedEventIndex}
						onSelectEvent={onSelectEvent}
					/>
				) : (
					<RawEventList
						events={deduped}
						origin={origin}
						selectedEventIndex={selectedEventIndex}
						onSelectEvent={onSelectEvent}
					/>
				)}
			</div>
		</div>
	);
}
