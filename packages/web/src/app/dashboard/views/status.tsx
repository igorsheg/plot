import type { PlotSessionSummary } from "@plot/control/session-summary";

import type { StatusTone } from "@/components/ui/status-indicator";

// Domain state → semantic tone. Kept in one place so the dot colour for a given
// state is identical everywhere it appears (fleet rail, session header).
export function toneForSessionState(
	state: PlotSessionSummary["state"],
): StatusTone {
	if (state === "error") return "danger";
	if (state === "paused") return "attention";
	if (state === "stopped" || state === "idle") return "muted";
	return "active";
}
