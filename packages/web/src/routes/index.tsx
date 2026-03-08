import { createRoute } from "@tanstack/react-router";
import { Route as rootRoute } from "./__root";
import { Dashboard } from "@/components/dashboard";
import { OpsPanel } from "@/components/dashboard/ops-panel";

/**
 * keeps the default dashboard honest: orientation first, inspection second.
 *
 * this route should answer only three questions at a glance — is work happening,
 * does anything need attention, and what deserves a closer look. per-item detail
 * lives in the sheet so debug surfaces do not sprawl back into the page.
 */
function DashboardPage() {
	return (
		<Dashboard.Root>
			<Dashboard.Header />
			<OpsPanel />
			<div className="view-shell">
				<Dashboard.WorkQueue />
			</div>
			<Dashboard.WorkDetailSheet />
		</Dashboard.Root>
	);
}

export const Route = createRoute({
	getParentRoute: () => rootRoute,
	path: "/",
	component: DashboardPage,
});
