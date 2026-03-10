import { Effect } from "effect";

export const withTrackerFallback = <A>(
  effect: Effect.Effect<A, unknown>,
  operation: string,
  fallback: A,
): Effect.Effect<A> =>
  effect.pipe(
    Effect.tapError((e) =>
      Effect.logWarning("tracker_fetch_failed").pipe(
        Effect.annotateLogs({ operation, error: String(e) }),
      ),
    ),
    Effect.catchAll(() => Effect.succeed(fallback)),
  );
