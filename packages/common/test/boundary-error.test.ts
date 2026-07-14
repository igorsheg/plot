import { expect, test } from "bun:test";
import {
	PlotBoundaryError,
	toBoundaryErrorRecord,
} from "../src/boundary-error.js";

test("boundary errors preserve intentional fields and hide unknown causes", () => {
	const owned = toBoundaryErrorRecord(
		new PlotBoundaryError({
			code: "owned_error",
			message: "safe message",
			retryable: true,
			context: { operation: "tick" },
		}),
		"test",
	);
	expect(owned).toEqual({
		code: "owned_error",
		message: "safe message",
		retryable: true,
		context: { operation: "tick" },
	});

	const unknown = toBoundaryErrorRecord(
		new Error("secret provider response"),
		"test-boundary",
	);
	expect(unknown).toEqual({
		code: "internal_error",
		message: "Internal Plot error at test-boundary",
		retryable: false,
		context: { boundary: "test-boundary" },
	});
});
