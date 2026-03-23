import { Cause, Effect } from "effect";
import { TrackerAuthError, TrackerValidationError, TrackerNotFoundError } from "@plot/sdk";

const isFatal = (error: unknown): boolean =>
	error instanceof TrackerAuthError ||
	error instanceof TrackerValidationError ||
	error instanceof TrackerNotFoundError;

export const withTrackerFallback = <A>(
	effect: Effect.Effect<A, unknown>,
	operation: string,
	fallback: A,
): Effect.Effect<A> =>
	effect.pipe(
		Effect.catchCause((cause) => {
			const error = Cause.squash(cause);

			if (isFatal(error)) {
				return Effect.logError("tracker_fatal_error").pipe(
					Effect.annotateLogs({ operation, error: String(error) }),
					Effect.flatMap(() => Effect.die(error)),
				);
			}

			const isDefect = Cause.hasDies(cause);
			return Effect.logWarning(isDefect ? "tracker_defect" : "tracker_fetch_failed").pipe(
				Effect.annotateLogs({
					operation,
					error: String(error),
					defect: String(isDefect),
				}),
				Effect.as(fallback),
			);
		}),
	);
