import type { PlotSessionSummary } from "@plot/control/session-summary";
import { useNavigate } from "@tanstack/react-router";

import type { StatusTone } from "@/components/ui/status-indicator";
import { useDashboardMeta } from "../dashboard-context";
import type { ConnectionState, ControlRole } from "../web-dashboard-state";
import { MetaButton } from "./layout";

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

// Connection state → human label + dot tone. Lifted from the (retiring)
// app-sidebar's `connectionDot` so both the Lobby chrome and the Room's
// degraded look read the connection the same way. The two attention states
// (offline, handoff-missing) share the amber tone; the accent is reserved for
// actionable needs-you, so a degraded connection reads as a muted/attention dot
// but never the chromatic "needs you" accent.

/** Human label for the connection state — what the chrome shows next to the dot. */
export const connectionLabel = (connection: ConnectionState): string => {
	switch (connection) {
		case "online":
			return "online";
		case "connecting":
			return "connecting";
		case "offline":
			return "offline · last frame";
		case "handoff-missing":
			return "handoff needed";
	}
};

/** Dot tone for the connection state, matching `connectionLabel`. */
export const connectionTone = (connection: ConnectionState): StatusTone => {
	switch (connection) {
		case "online":
			return "online";
		case "connecting":
			return "muted";
		case "offline":
		case "handoff-missing":
			return "attention";
	}
};

// ─── role toggle ───────────────────────────────────────────────────────────
// Controller ⇄ observer is a cross-cutting modifier carried in the `?role=`
// search param (see router.tsx) — there is no role setter in the dashboard
// actions, so the toggle is pure navigation. A MetaButton keeps it chrome: it
// reads as meta, never a primary action.
export function RoleToggle() {
	const { controlRole } = useDashboardMeta();
	const navigate = useNavigate();
	return (
		<MetaButton
			onClick={() =>
				// Stay on the current route (`to: "."`), flipping only the `?role=`
				// modifier — the role lives in the search param, not in dashboard actions.
				void navigate({
					to: ".",
					search: (prev: { role?: ControlRole }): { role: ControlRole } => ({
						role: prev.role === "observer" ? "controller" : "observer",
					}),
				})
			}
		>
			⇅ {controlRole}
		</MetaButton>
	);
}
