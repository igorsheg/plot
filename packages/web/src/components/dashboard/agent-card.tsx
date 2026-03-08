import * as React from "react";
import { DateTime } from "effect";
import type { RunningEntry, LiveSession } from "@plot/sdk";
import { useDashboard } from "./root";
import { statusLabel, statusVariant, isActiveState } from "./status";
import { timeAgo as sharedTimeAgo } from "@plot/sdk";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface WorkRowProps {
	entry: RunningEntry;
	isSelected: boolean;
}

function formatTimeAgo(dt: DateTime.Utc | string): string {
	if (typeof dt === "string") return sharedTimeAgo(new Date(dt).getTime());
	return sharedTimeAgo(DateTime.toEpochMillis(dt));
}

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

export function WorkRow({ entry, isSelected }: WorkRowProps) {
	const { actions } = useDashboard();
	const { session } = entry;
	const active = isActiveState(entry.state);
	const phaseText = phaseLabel(session);
	const handleClick = React.useCallback(() => {
		actions.focusIssue(entry.issueId);
	}, [actions, entry.issueId]);

	return (
		<button
			type="button"
			className={cn(
				"row-shell",
				active && "row-shell-active",
				isSelected && "row-shell-selected",
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
				{phaseText && (
					<p className="type-meta truncate">{phaseText}</p>
				)}
			</div>
			<div className="type-meta shrink-0">
				{session.lastEventAt ? formatTimeAgo(session.lastEventAt) : "idle"}
			</div>
		</button>
	);
}
