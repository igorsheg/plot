import { describe, expect, test } from "bun:test";
import { runPlotTui } from "../src/plot-tui.js";

describe("Plot TUI", () => {
	test("exports the managed-run TUI runner", () => {
		expect(typeof runPlotTui).toBe("function");
	});
});
