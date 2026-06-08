import {
	Cause,
	Clock,
	Effect,
	Exit,
	Layer,
	Logger,
	References,
	type LogLevel,
} from "effect";

export type Fields = Record<string, unknown>;

export interface LoggerOptions {
	readonly format?: "json" | "pretty" | "logfmt";
	readonly level?: LogLevel.LogLevel;
	readonly stderr?: boolean;
}

export const LoggerLive = (options: LoggerOptions = {}) => {
	const logger =
		options.format === "pretty"
			? Logger.consolePretty()
			: options.format === "logfmt"
				? Logger.consoleLogFmt
				: Logger.consoleJson;

	return Layer.mergeAll(
		Logger.layer([logger]),
		Layer.succeed(References.MinimumLogLevel, options.level ?? "Info"),
		Layer.succeed(Logger.LogToStderr, options.stderr ?? true),
	);
};

const exitFields = <A, E>(exit: Exit.Exit<A, E>): Fields => {
	if (Exit.isSuccess(exit)) {
		return { outcome: "success" };
	}
	return {
		outcome: "error",
		error: Cause.pretty(exit.cause),
	};
};

export const logWideEvent = (
	fields: Fields,
	level: "info" | "error" = "info",
) => (level === "error" ? Effect.logError(fields) : Effect.logInfo(fields));

export const withWideEvent = <A, E, R>(
	operation: string,
	fields: Fields,
	effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
	Effect.gen(function* () {
		const startedAt = yield* Clock.currentTimeMillis;
		const exit = yield* Effect.exit(effect);
		const finishedAt = yield* Clock.currentTimeMillis;
		const event = {
			operation,
			...fields,
			...exitFields(exit),
			duration_ms: finishedAt - startedAt,
		};
		yield* logWideEvent(event, Exit.isSuccess(exit) ? "info" : "error");
		if (Exit.isSuccess(exit)) return exit.value;
		return yield* Effect.failCause(exit.cause);
	}).pipe(Effect.annotateLogs({ operation }), Effect.withLogSpan(operation));

export const withFields = <A, E, R>(
	fields: Fields,
	effect: Effect.Effect<A, E, R>,
) => effect.pipe(Effect.annotateLogs(fields));
