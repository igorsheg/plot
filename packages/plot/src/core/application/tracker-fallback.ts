import { Cause, Effect } from "effect";
import type { TrackerError } from "@plot/sdk";

const isFatal = (error: TrackerError): boolean =>
	error._tag === "TrackerAuthError" ||
	error._tag === "TrackerValidationError" ||
	error._tag === "TrackerNotFoundError";

export const withTrackerFallback = <A>(
	effect: Effect.Effect<A, TrackerError>,
	operation: string,
	fallback: A,
): Effect.Effect<A> =>
	effect.pipe(
		Effect.catchCause((cause) => {
			const error = Cause.squash(cause) as TrackerError;

			if (isFatal(error)) {
				return Effect.logError("tracker_fatal_error").pipe(
					Effect.annotateLogs({ operation, error: error.message }),
					Effect.flatMap(() => Effect.die(error)),
				);
			}

			const isDefect = Cause.hasDies(cause);
			return Effect.logWarning(isDefect ? "tracker_defect" : "tracker_fetch_failed").pipe(
				Effect.annotateLogs({
					operation,
					error: error.message,
					defect: String(isDefect),
				}),
				Effect.as(fallback),
			);
		}),
	);
