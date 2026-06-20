import type { PlotSessionSummary } from "@plot/control/session-summary";

import type { StatusTone } from "@/components/ui/status-indicator";

// Domain state → semantic tone. Kept in one place so the dot colour for a given
// state is identical everywhere it appears (fleet rail, session header).
//
// The key distinction the rail has to make legible: **running** (agents working
// right now) vs **inactive** (alive but waiting). `acting`/`reconciling` or any
// session with active agents is live; `watching`/`idle` with none is muted.

/** Running right now — agents active or mid reconcile/act. */
export const sessionIsRunning = (session: {
	readonly state: PlotSessionSummary["state"];
	readonly agents: { readonly active: number };
}): boolean =>
	session.state === "acting" ||
	session.state === "reconciling" ||
	session.agents.active > 0;

export function toneForSession(session: {
	readonly state: PlotSessionSummary["state"];
	readonly agents: { readonly active: number };
}): StatusTone {
	if (session.state === "error") return "danger";
	if (session.state === "paused") return "attention";
	if (session.state === "stopped" || session.state === "idle") return "muted";
	if (sessionIsRunning(session)) return "live";
	// starting / watching / stopping — alive but not working
	return "muted";
}
