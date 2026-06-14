import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { WorkerPoolContext } from "../src/app/_components/WorkerPoolContext";
import { ReviewUI } from "../src/app/_components/ReviewUI";

test("viewer substrate imports without browser global shims", () => {
	expect(WorkerPoolContext).toBeFunction();
	expect(ReviewUI).toBeFunction();
});

test("worker pool provider has a server-renderable shell", () => {
	const html = renderToStaticMarkup(
		<WorkerPoolContext>
			<div>viewer shell</div>
		</WorkerPoolContext>,
	);

	expect(html).toContain("viewer shell");
});
