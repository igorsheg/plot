import { describe, expect, test } from "bun:test";
import { Effect, Exit } from "effect";
import { withWideEvent } from "../src/observability/index.js";

describe("observability wide events", () => {
	test("preserves success values", async () => {
		const result = await Effect.runPromise(
			withWideEvent("test.success", { request_id: "req-1" }, Effect.succeed(42)),
		);
		expect(result).toBe(42);
	});

	test("preserves failures", async () => {
		const exit = await Effect.runPromise(
			withWideEvent("test.failure", { request_id: "req-2" }, Effect.fail("boom")).pipe(Effect.exit),
		);
		expect(Exit.isFailure(exit)).toBe(true);
	});
});
