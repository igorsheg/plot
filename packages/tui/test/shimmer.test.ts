import { describe, expect, test } from "bun:test";
import { quoteActivity, shimmerText } from "../src/shimmer.js";

const stripAnsi = (text: string) =>
	text.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"), "");

describe("TUI shimmer", () => {
	test("keeps grapheme clusters intact while styling live text", () => {
		const text = "e\u0301👩‍🚀 checking";
		const shimmered = shimmerText(text, 640);
		expect(stripAnsi(shimmered)).toBe(text);
	});

	test("quotes model prose but not command output", () => {
		expect(quoteActivity("agent message streaming: checking the build")).toBe(
			"“checking the build”",
		);
		expect(quoteActivity("command output streaming: yarn failed")).toBe(
			"yarn failed",
		);
	});
});
