import { expect, test } from "bun:test";
import { plotAlpha } from "../src/index.js";

test("alpha reset keeps the core loop explicit", () => {
	expect(plotAlpha.coreLoop).toEqual(["tick", "reconcile", "act"]);
});
