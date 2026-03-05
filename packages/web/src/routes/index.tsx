import { createRoute } from "@tanstack/react-router";
import { Route as rootRoute } from "./__root";
import { Dashboard } from "@/components/dashboard";

export const Route = createRoute({
	getParentRoute: () => rootRoute,
	path: "/",
	component: () => (
		<Dashboard.Root>
			<Dashboard.Header />
			<Dashboard.Metrics />
			<Dashboard.Sessions />
			<Dashboard.Detail />
			<Dashboard.RetryQueue />
		</Dashboard.Root>
	),
});
