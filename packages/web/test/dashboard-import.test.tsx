import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { DashboardPage } from "../src/app/dashboard/DashboardPage";
import { mockDashboardState } from "../src/app/dashboard/mock-dashboard-state";

test("plot dashboard mock renders the product model", () => {
	const html = renderToStaticMarkup(
		<DashboardPage state={mockDashboardState} />,
	);

	expect(html).toContain("Plot operations cockpit");
	expect(html).toContain("tick → reconcile → act");
	expect(html).toContain("Review web substrate PR");
});
