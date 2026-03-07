import { useEffect } from "react";
import { DateTime } from "effect";
import { useDashboard } from "./root";
import { AgentCard } from "./agent-card";
import { useRuntimeState } from "@/lib/hooks";
import {
	Empty,
	EmptyHeader,
	EmptyTitle,
	EmptyDescription,
} from "@/components/ui/empty";

export function AgentGrid() {
	const {
		state: { focusedIssueId },
		actions,
	} = useDashboard();
	const { data: snapshot } = useRuntimeState();

	const running = [...(snapshot?.running ?? [])].sort((a, b) => {
		const aAt = a.session.lastEventAt
			? Number(DateTime.toEpochMillis(a.session.lastEventAt))
			: 0;
		const bAt = b.session.lastEventAt
			? Number(DateTime.toEpochMillis(b.session.lastEventAt))
			: 0;
		return bAt - aAt;
	});

	useEffect(() => {
		if (running.length === 1) {
			actions.focusIssue(running[0]?.issueId ?? null);
			return;
		}
		if (
			focusedIssueId &&
			!running.some((entry) => entry.issueId === focusedIssueId)
		) {
			actions.focusIssue(null);
		}
	}, [actions, focusedIssueId, running]);

	if (running.length === 0) {
		return (
			<Empty>
				<EmptyHeader>
					<EmptyTitle>no active agents</EmptyTitle>
					<EmptyDescription>
						agents will appear here when issues are dispatched
					</EmptyDescription>
				</EmptyHeader>
			</Empty>
		);
	}

	return (
		<section className="section-shell">
			<div>
				<h2 className="type-meta">active agents</h2>
			</div>
			<div className="panel-shell">
				{running.map((entry) => (
					<AgentCard
						key={entry.issueId}
						entry={entry}
						isSelected={entry.issueId === focusedIssueId}
					/>
				))}
			</div>
		</section>
	);
}
