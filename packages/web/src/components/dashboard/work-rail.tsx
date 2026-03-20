import { useCallback } from "react";
import { DateTime } from "effect";
import type { RunningEntry, RetryEntry, LiveSession } from "@plot/sdk";
import { formatTokens, formatTimeAgo } from "@/lib/format";
import { useDashboard } from "./root";
import { statusLabel, statusVariant, isActiveState } from "./status";
import { useRuntimeSnapshot } from "@/lib/runtime";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { PhaseLabel } from "./phase-label";

function phaseLabel(session: LiveSession): string | null {
	switch (session.phase) {
		case "thinking":
			return "thinking…";
		case "tool_execution": {
			const tool = session.activeTools[session.activeTools.length - 1];
			if (!tool) return "executing…";
			const labels: Record<string, string> = {
				read: "reading",
				edit: "editing",
				write: "writing",
				bash: "running command",
				grep: "searching",
				find: "finding files",
				ls: "listing",
			};
			return (labels[tool.toolName] ?? tool.toolName) + "…";
		}
		case "compacting":
			return "compacting…";
		case "retrying":
			return "retrying…";
		default:
			return null;
	}
}

export function WorkRail() {
	const {
		state: { focusedIssueId },
		actions,
	} = useDashboard();
	const snapshot = useRuntimeSnapshot();

	const running = [...(snapshot?.running ?? [])].sort((a, b) => {
		const aAt = a.session.lastEventAt ? Number(DateTime.toEpochMillis(a.session.lastEventAt)) : 0;
		const bAt = b.session.lastEventAt ? Number(DateTime.toEpochMillis(b.session.lastEventAt)) : 0;
		return bAt - aAt;
	});

	const retrying = snapshot?.retrying ?? [];

	if (running.length === 0 && retrying.length === 0) {
		return (
			<div className="work-rail">
				<div className="flex flex-1 items-center justify-center">
					<p className="type-meta">no active work</p>
				</div>
			</div>
		);
	}

	return (
		<div className="work-rail">
			<div className="flex flex-1 flex-col overflow-y-auto">
				{running.map((entry) => (
					<RunningRow
						key={entry.issueId}
						entry={entry}
						isSelected={entry.issueId === focusedIssueId}
						onClick={actions.focusIssue}
					/>
				))}

				{retrying.length > 0 && (
					<div className="border-t border-border px-3 py-2">
						<p className="type-meta mb-1">retrying</p>
						{retrying.map((entry) => (
							<RetryRow
								key={entry.issueId}
								entry={entry}
								isSelected={entry.issueId === focusedIssueId}
								onClick={actions.focusIssue}
							/>
						))}
					</div>
				)}
			</div>
		</div>
	);
}

function RunningRow({
	entry,
	isSelected,
	onClick,
}: {
	entry: RunningEntry;
	isSelected: boolean;
	onClick: (id: string) => void;
}) {
	const { session } = entry;
	const active = isActiveState(entry.state);
	const phaseText = phaseLabel(session);

	const handleClick = useCallback(() => {
		onClick(entry.issueId);
	}, [onClick, entry.issueId]);

	return (
		<button
			type="button"
			className={cn(
				"row-shell px-3 py-2",
				active && "border-l-2 border-l-emerald-400",
				isSelected && "bg-accent/60",
			)}
			onClick={handleClick}
		>
			<div className="min-w-0 flex-1">
				<div className="cluster-shell">
					<span className="type-title truncate">{entry.issueIdentifier}</span>
					<Badge variant={statusVariant(entry.state)} size="sm">
						{statusLabel(entry.state)}
					</Badge>
				</div>
				<PhaseLabel text={phaseText} className="type-meta truncate" />
			</div>
			<div className="type-meta shrink-0 text-right">
				<span>
					t{session.turnCount} · {formatTokens(session.totalTokens)}
				</span>
				<br />
				<span>{session.lastEventAt ? formatTimeAgo(session.lastEventAt) : "idle"}</span>
			</div>
		</button>
	);
}

function RetryRow({
	entry,
	isSelected,
	onClick,
}: {
	entry: RetryEntry;
	isSelected: boolean;
	onClick: (id: string) => void;
}) {
	const handleClick = useCallback(() => {
		onClick(entry.issueId);
	}, [onClick, entry.issueId]);

	return (
		<button
			type="button"
			className={cn("row-shell px-3 py-2 opacity-60", isSelected && "bg-accent/60")}
			onClick={handleClick}
		>
			<div className="min-w-0 flex-1">
				<div className="cluster-shell">
					<span className="type-title truncate">{entry.identifier}</span>
					<Badge variant="outline" size="sm">
						attempt {entry.attempt}
					</Badge>
				</div>
			</div>
			<div className="type-meta shrink-0">{formatTimeAgo(entry.dueAt)}</div>
		</button>
	);
}
