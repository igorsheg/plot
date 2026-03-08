import { createRoute } from "@tanstack/react-router";
import { Route as rootRoute } from "./__root";
import { Dashboard } from "@/components/dashboard";
import { useDashboard } from "@/components/dashboard/root";

function DashboardLayout() {
	const { state } = useDashboard();
	return (
		<div className="view-shell">
			<div className={state.opsOpen ? "workspace-grid-with-detail" : "workspace-grid"}>
				<Dashboard.WorkRail />
				<Dashboard.AgentWorkspace />
				{state.opsOpen && <Dashboard.OpsPanel />}
			</div>
		</div>
	);
}

function DashboardPage() {
	return (
		<Dashboard.Root>
			<Dashboard.Header />
			<DashboardLayout />
		</Dashboard.Root>
	);
}

export const Route = createRoute({
	getParentRoute: () => rootRoute,
	path: "/",
	component: DashboardPage,
});
