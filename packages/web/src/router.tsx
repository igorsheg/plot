import {
	createRootRouteWithContext,
	createRoute,
	createRouter,
	Outlet,
	useNavigate,
	useParams,
} from "@tanstack/react-router";
import { useEffect } from "react";

import {
	DashboardProvider,
	useDashboardState,
} from "./app/dashboard/dashboard-context";
import { chooseInitialSession } from "./app/dashboard/fleet-model";
import {
	type ControlRole,
	type PlotWebDashboardState,
	usePlotWebDashboardState,
} from "./app/dashboard/web-dashboard-state";
import { SessionSurface } from "./app/dashboard/views/session-surface";
import { TriageLobby } from "./app/dashboard/views/triage-lobby";

// Tests render through the router but inject a fixed frame instead of a live WS
// connection — the override rides the router context.
export interface DashboardRouterContext {
	readonly stateOverride?: PlotWebDashboardState | undefined;
}

const role = (value: unknown): ControlRole =>
	value === "observer" ? "observer" : "controller";

const rootRoute = createRootRouteWithContext<DashboardRouterContext>()({
	// `?role=observer` is a cross-cutting modifier on every route; everything
	// else is path-driven, so this is the only validated search param.
	validateSearch: (search: Record<string, unknown>): { role: ControlRole } => ({
		role: role(search["role"]),
	}),
	component: RootLayout,
});

function RootLayout() {
	const { role: controlRole } = rootRoute.useSearch();
	const params = useParams({ strict: false });
	const { stateOverride } = rootRoute.useRouteContext();
	const live = usePlotWebDashboardState({
		sessionId: params.sessionId,
		role: controlRole,
	});
	const state = stateOverride ?? live;
	// The shell is now a plain scroll container; each route owns its own width —
	// the Lobby centers its column, the Room is full-bleed. The fleet sidebar is
	// retired (the Lobby is the cross-fleet surface, the Room switches sessions).
	return (
		<DashboardProvider state={state}>
			<div className="min-h-screen overflow-y-auto bg-background">
				<Outlet />
			</div>
		</DashboardProvider>
	);
}

// Resolve the initial route once per page load: landing on the fleet with
// exactly ONE reachable session collapses straight into it (the common
// `plot` → open-web case). Module-scoped so navigating back to the Lobby
// afterwards does not bounce — only a fresh load re-resolves. With more than
// one session the Lobby is the destination; we never auto-redirect.
let initialRouteResolved = false;

function FleetRoute() {
	const { roster, connection } = useDashboardState();
	const navigate = useNavigate();
	useEffect(() => {
		if (initialRouteResolved || connection !== "online") return;
		// Only the single-reachable-session case collapses into the Room; any
		// multi-session roster stays on the Lobby (the cross-fleet surface).
		if (roster.length !== 1) return;
		const top = chooseInitialSession({ roster, explicitFleet: false });
		if (top === undefined) return;
		initialRouteResolved = true;
		void navigate({
			to: "/session/$sessionId",
			params: { sessionId: top },
			search: (prev) => ({ role: prev.role ?? "controller" }),
			replace: true,
		});
	}, [roster, connection, navigate]);
	return <TriageLobby />;
}

const indexRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/",
	component: FleetRoute,
});

const sessionRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "session/$sessionId",
	component: SessionSurface,
});

export const routeTree = rootRoute.addChildren([indexRoute, sessionRoute]);

export function createDashboardRouter(context: DashboardRouterContext = {}) {
	return createRouter({ routeTree, context });
}

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof createDashboardRouter>;
	}
}
