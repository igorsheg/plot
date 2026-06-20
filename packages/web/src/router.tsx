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
import { FleetRail, OverviewPane } from "./app/dashboard/views/fleet-rail";
import { SessionSurface } from "./app/dashboard/views/session-surface";

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
	return (
		<DashboardProvider state={state}>
			{/* The screen is two regions: the fleet rail (the single left chrome —
			    brand, connection, session list) and the room (the selected session,
			    full-bleed). No top bar, no per-session back link: the rail owns
			    session switching, the room owns the live surface. */}
			<div className="flex h-dvh bg-background text-foreground">
				<FleetRail />
				<div className="min-w-0 flex-1 overflow-y-auto">
					{params.sessionId === undefined ? (
						<div className="mx-auto w-full max-w-5xl px-gutter py-6">
							<Outlet />
						</div>
					) : (
						<Outlet />
					)}
				</div>
			</div>
		</DashboardProvider>
	);
}

// Resolve the initial route once per page load: landing on the fleet with
// exactly one reachable session collapses straight into it (the common
// `plot` → open-web case). Module-scoped so navigating back to "all
// sessions" afterwards does not bounce — only a fresh load re-resolves.
let initialRouteResolved = false;

function FleetRoute() {
	const { roster, connection } = useDashboardState();
	const navigate = useNavigate();
	useEffect(() => {
		if (initialRouteResolved || connection !== "online") return;
		initialRouteResolved = true;
		// Landing on `/` dives into the top session (the rail already shows the
		// fleet, so `/` is never a browse view). Picks the single reachable one,
		// else the most-needs-you / most-active — same order the rail lists in.
		const top =
			chooseInitialSession({ roster, explicitFleet: false }) ?? roster[0]?.id;
		if (top !== undefined) {
			void navigate({
				to: "/session/$sessionId",
				params: { sessionId: top },
				search: (prev) => ({ role: prev.role ?? "controller" }),
				replace: true,
			});
		}
	}, [roster, connection, navigate]);
	return <OverviewPane />;
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
