import type { PlotSessionSummary } from "@plot/control/session-summary";

import {
	StatusDot,
	StatusIndicator,
	type StatusTone,
} from "@/components/ui/status-indicator";

// Domain state → semantic tone. Kept in one place so the dot colour for a given
// state is identical everywhere it appears (fleet table, session header, rows).
export function toneForSessionState(
	state: PlotSessionSummary["state"],
): StatusTone {
	if (state === "error") return "danger";
	if (state === "paused") return "attention";
	if (state === "stopped" || state === "idle") return "muted";
	return "active";
}

export function toneForStage(stage: string): StatusTone {
	if (stage === "blocked") return "attention";
	if (stage === "failed") return "danger";
	if (stage === "completed") return "muted";
	return "active";
}

export function SessionStateIndicator({
	state,
}: {
	state: PlotSessionSummary["state"];
}) {
	return (
		<StatusIndicator tone={toneForSessionState(state)}>{state}</StatusIndicator>
	);
}

export function WorkStageDot({ stage }: { stage: string }) {
	return <StatusDot tone={toneForStage(stage)} />;
}
