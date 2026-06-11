import { describe, expect, test } from "bun:test";
import { withWideEvent } from "../src/observability.js";

describe("observability wide events", () => {
	test("preserves success values", async () => {
		const result = await withWideEvent(
			"test.success",
			{ request_id: "req-1" },
			() => 42,
		);
		expect(result).toBe(42);
	});

	test("preserves failures", async () => {
		await expect(
			withWideEvent("test.failure", { request_id: "req-2" }, () =>
				Promise.reject("boom"),
			),
		).rejects.toBe("boom");
	});
});
