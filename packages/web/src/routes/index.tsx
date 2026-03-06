import { createRoute } from "@tanstack/react-router";
import { Route as rootRoute } from "./__root";
import { Dashboard } from "@/components/dashboard";

export const Route = createRoute({
	getParentRoute: () => rootRoute,
	path: "/",
	component: () => (
		<Dashboard.Root>
			<Dashboard.Header />
			<div className="max-w-5xl space-y-6 px-8 py-6">
				<Dashboard.AgentGrid />
				<Dashboard.AgentDetail />
				<Dashboard.RetrySection />
			</div>
		</Dashboard.Root>
	),
});
