import { DashboardProvider } from "./dashboard-context";
import {
	surfaceForState,
	usePlotWebDashboardState,
	type PlotWebDashboardState,
} from "./web-dashboard-state";
import { FleetSurface } from "./views/fleet-surface";
import { SessionSurface } from "./views/session-surface";
import { TopBar } from "./views/top-bar";

// Thin shell: lift the live state into the DashboardProvider, then route to the
// active surface. Tests inject `state` directly; the app uses the live hook.
// All screen logic lives in the view components, which read context slices.
export function DashboardPage({ state }: { state?: PlotWebDashboardState }) {
	const liveState = usePlotWebDashboardState();
	const dashboardState = state ?? liveState;
	const surface = surfaceForState(dashboardState);
	return (
		<DashboardProvider state={dashboardState}>
			<main className="min-h-dvh bg-background text-foreground">
				<div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col px-5 pb-12 md:px-8">
					<TopBar />
					{surface === "session" ? <SessionSurface /> : <FleetSurface />}
				</div>
			</main>
		</DashboardProvider>
	);
}
