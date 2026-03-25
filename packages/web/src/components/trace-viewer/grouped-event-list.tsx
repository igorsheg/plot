import { useMemo } from "react";
import { DateTime } from "effect";
import { cn } from "@plot/ui/lib/utils";
import { formatTimestamp } from "@/lib/format";
import { useTraceViewer } from "./root";
import {
	groupEventsIntoTurns,
	filterGroups,
	type TurnGroup,
	type ToolCallGroup,
	type UngroupedSection,
} from "./group-events";

const toolColorMap: Record<string, string> = {
	bash: "text-emerald-400",
	read: "text-sky-400",
	edit: "text-violet-400",
	write: "text-amber-400",
	grep: "text-cyan-400",
	find: "text-teal-400",
	skill: "text-purple-400",
	finder: "text-cyan-400",
	ls: "text-teal-400",
	compaction: "text-amber-400",
	retry: "text-red-400",
};

function formatDuration(ms: number): string {
	if (ms < 1000) return `${Math.round(ms)}ms`;
	if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
	const m = Math.floor(ms / 60000);
	const s = Math.round((ms % 60000) / 1000);
	return `${m}m ${s}s`;
}

function formatRelative(base: DateTime.Utc, event: DateTime.Utc): string {
	const diff = Number(DateTime.toEpochMillis(event)) - Number(DateTime.toEpochMillis(base));
	return `+${formatDuration(Math.abs(diff))}`;
}

function truncate(text: string, max: number): string {
	if (text.length > max) return text.slice(0, max) + "…";
	return text;
}

function PulseDot() {
	return (
		<span className="relative flex size-2 shrink-0">
			<span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400/40" />
			<span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
		</span>
	);
}

function TurnSection({ turn }: { turn: TurnGroup }) {
	const { actions } = useTraceViewer();

	const items: Array<
		{ kind: "tool"; tc: ToolCallGroup } | { kind: "notification"; message: string }
	> = [];
	for (const tc of turn.toolCalls) {
		items.push({ kind: "tool", tc });
	}
	for (const n of turn.notifications) {
		items.push({ kind: "notification", message: n });
	}

	return (
		<div>
			<div className="trace-turn-header flex items-center gap-2 border-b border-border/50 bg-muted/30 px-3 py-2 type-body">
				<span className="shrink-0 type-meta">turn {turn.turnIndex}</span>
				{turn.narration && (
					<span className="min-w-0 flex-1 truncate text-foreground">
						{truncate(turn.narration, 80)}
					</span>
				)}
				{!turn.narration && <span className="flex-1" />}
				<span className="flex shrink-0 items-center gap-2 type-meta tabular-nums">
					{turn.tokenUsage && <span>{turn.tokenUsage.totalTokens.toLocaleString()} tok</span>}
					{turn.durationMs != null && <span>{formatDuration(turn.durationMs)}</span>}
					{turn.isActive && <PulseDot />}
				</span>
			</div>
			{items.map((item, i) => {
				const isLast = i === items.length - 1;
				const connector = isLast ? "└─" : "├─";

				if (item.kind === "tool") {
					const { tc } = item;
					const color = toolColorMap[tc.toolName] ?? "text-zinc-400";
					return (
						<button
							key={tc.toolCallId ?? `tc-${i}`}
							type="button"
							className={cn(
								"trace-tool-row flex w-full items-center gap-2 px-3 py-1 pl-6 type-body hover:bg-accent/20 cursor-pointer text-left",
								tc.isError && "text-red-400/80",
							)}
							onClick={() => actions.selectEvent(tc.events[tc.events.length - 1] ?? null)}
						>
							<span className="w-4 shrink-0 type-meta">{connector}</span>
							<span className={cn("w-[72px] shrink-0 truncate", color)}>{tc.toolName}</span>
							<span className="min-w-0 flex-1 truncate text-foreground">
								{tc.summary ? truncate(tc.summary, 80) : ""}
							</span>
							<span className="shrink-0 type-meta tabular-nums">
								{formatRelative(turn.startedAt, tc.startedAt)}
							</span>
							<span className="w-14 shrink-0 text-right type-meta tabular-nums">
								{tc.isActive ? (
									<PulseDot />
								) : tc.durationMs != null ? (
									formatDuration(tc.durationMs)
								) : (
									""
								)}
							</span>
						</button>
					);
				}

				return (
					<div key={`notif-${i}`} className="flex items-center gap-2 px-3 py-1 pl-6 type-body">
						<span className="w-4 shrink-0 type-meta">{connector}</span>
						<span className="w-[72px] shrink-0 text-muted-foreground">··</span>
						<span className="min-w-0 flex-1 truncate text-muted-foreground">
							{truncate(item.message, 80)}
						</span>
					</div>
				);
			})}
		</div>
	);
}

function UngroupedEvents({ section }: { section: UngroupedSection }) {
	const label = section.kind === "preamble" ? "agent lifecycle" : "agent shutdown";

	return (
		<div>
			<div className="px-3 py-1 type-meta">{label}</div>
			{section.events.map((ev, i) => (
				<div key={`${section.kind}-${i}`} className="flex items-center gap-2 px-3 py-1 type-meta">
					<span className="shrink-0 tabular-nums">{formatTimestamp(ev.timestamp)}</span>
					<span className="w-[72px] shrink-0 truncate">{ev.event}</span>
					{ev.message && (
						<span className="min-w-0 flex-1 truncate">{truncate(ev.message, 120)}</span>
					)}
				</div>
			))}
		</div>
	);
}

export function GroupedEventList() {
	const { state } = useTraceViewer();

	const groups = useMemo(() => groupEventsIntoTurns(state.events), [state.events]);

	const filtered = useMemo(
		() => filterGroups(groups, state.query, state.typeFilter),
		[groups, state.query, state.typeFilter],
	);

	if (filtered.length === 0) {
		return (
			<div className="flex flex-1 items-center justify-center p-8">
				<p className="type-meta">
					{state.events.length === 0 ? "no events yet" : "no matching events"}
				</p>
			</div>
		);
	}

	return (
		<>
			{filtered.map((group) => {
				if (group.kind === "turn") {
					return <TurnSection key={`turn-${group.turnIndex}`} turn={group} />;
				}
				return <UngroupedEvents key={group.kind} section={group} />;
			})}
		</>
	);
}

export default GroupedEventList;
