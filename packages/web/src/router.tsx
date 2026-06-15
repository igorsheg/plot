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
import { FleetSurface } from "./app/dashboard/views/fleet-surface";
import { SessionSurface } from "./app/dashboard/views/session-surface";
import { TopBar } from "./app/dashboard/views/top-bar";

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
			<main className="min-h-dvh bg-background text-foreground">
				<div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col px-5 pb-12 md:px-8">
					<TopBar />
					<Outlet />
				</div>
			</main>
		</DashboardProvider>
	);
}

// Resolve the initial route once per page load: landing on the fleet with
// exactly one reachable session collapses straight into it (the common
// `plot tui` → open-web case). Module-scoped so navigating back to "all
// sessions" afterwards does not bounce — only a fresh load re-resolves.
let initialRouteResolved = false;

function FleetRoute() {
	const { roster, connection } = useDashboardState();
	const navigate = useNavigate();
	useEffect(() => {
		if (initialRouteResolved || connection !== "online") return;
		initialRouteResolved = true;
		const only = chooseInitialSession({ roster, explicitFleet: false });
		if (only !== undefined) {
			void navigate({
				to: "/session/$sessionId",
				params: { sessionId: only },
				search: (prev) => ({ role: prev.role ?? "controller" }),
				replace: true,
			});
		}
	}, [roster, connection, navigate]);
	return <FleetSurface />;
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
