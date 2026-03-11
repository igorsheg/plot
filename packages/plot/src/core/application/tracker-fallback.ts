import { Effect } from "effect";

import {
	TrackerAuthError,
	TrackerNetworkError,
	TrackerNotFoundError,
	TrackerRateLimitError,
	TrackerValidationError,
} from "@plot/sdk";

const getErrorTag = (error: unknown): string | undefined =>
	typeof error === "object" && error !== null && "_tag" in error
		? String(error._tag)
		: undefined;

const isTransient = (error: unknown): boolean => {
	const tag = getErrorTag(error);
	return tag === undefined
		? true
		: tag === TrackerNetworkError._tag || tag === TrackerRateLimitError._tag;
};

const isFatal = (error: unknown): boolean => {
	const tag = getErrorTag(error);
	return (
		tag === TrackerAuthError._tag ||
		tag === TrackerValidationError._tag ||
		tag === TrackerNotFoundError._tag
	);
};

export const withTrackerFallback = <A>(
	effect: Effect.Effect<A, unknown>,
	operation: string,
	fallback: A,
): Effect.Effect<A> =>
	effect.pipe(
		Effect.catchAll((error) => {
			if (isFatal(error)) {
				const errorTag = getErrorTag(error);
				return Effect.logError("tracker_fatal_error").pipe(
					Effect.annotateLogs({
						operation,
						error: String(error),
						...(errorTag ? { error_type: errorTag } : {}),
					}),
					Effect.flatMap(() => Effect.die(error)),
				);
			}

			return Effect.logWarning("tracker_fetch_failed").pipe(
				Effect.annotateLogs({
					operation,
					error: String(error),
					transient: String(isTransient(error)),
				}),
				Effect.as(fallback),
			);
		}),
	);
