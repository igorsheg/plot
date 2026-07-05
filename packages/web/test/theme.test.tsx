import { describe, expect, test } from "bun:test";
import { parseStoredMode, resolveDark } from "../src/theme/theme.js";

describe("theme", () => {
	test("stored mode parsing falls back to system for unknown values", () => {
		expect(parseStoredMode("light")).toBe("light");
		expect(parseStoredMode("dark")).toBe("dark");
		expect(parseStoredMode(null)).toBe("system");
		expect(parseStoredMode("blue")).toBe("system");
	});

	test("explicit modes ignore the OS; system follows it", () => {
		expect(resolveDark("dark", false)).toBe(true);
		expect(resolveDark("light", true)).toBe(false);
		expect(resolveDark("system", true)).toBe(true);
		expect(resolveDark("system", false)).toBe(false);
	});
});
