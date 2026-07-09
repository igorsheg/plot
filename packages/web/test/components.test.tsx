import { expect, test } from "bun:test";
import { ArrowsClockwiseIcon } from "@phosphor-icons/react";
import { renderToString } from "react-dom/server";
import { Button } from "../src/components/ui/button.js";
import { isNearBottom } from "../src/components/ui/stick-to-bottom.js";

test("buttons render Phosphor icon components", () => {
	expect(
		renderToString(
			<Button>
				<ArrowsClockwiseIcon />
			</Button>,
		),
	).toContain("svg");
});

test("stick-to-bottom threshold detects when a scroll container should stay pinned", () => {
	expect(
		isNearBottom({ scrollTop: 95, scrollHeight: 200, clientHeight: 100 }),
	).toBe(false);
	expect(
		isNearBottom({ scrollTop: 97, scrollHeight: 200, clientHeight: 100 }),
	).toBe(true);
});
