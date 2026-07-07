import { expect, test } from "bun:test";
import { ArrowsClockwiseIcon } from "@phosphor-icons/react";
import { renderToString } from "react-dom/server";
import { Button } from "../src/components/ui/button.js";

test("buttons render Phosphor icon components", () => {
	expect(
		renderToString(
			<Button>
				<ArrowsClockwiseIcon />
			</Button>,
		),
	).toContain("svg");
});
