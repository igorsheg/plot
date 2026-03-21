import { Effect } from "effect";

export function waitForShutdown(onShutdown: (signal: NodeJS.Signals) => void) {
	return Effect.callback<void>((resume) => {
		const shutdown = (signal: NodeJS.Signals) => {
			onShutdown(signal);
			resume(Effect.void);
		};
		const onSigint = () => shutdown("SIGINT");
		const onSigterm = () => shutdown("SIGTERM");
		process.on("SIGINT", onSigint);
		process.on("SIGTERM", onSigterm);
		return Effect.sync(() => {
			process.off("SIGINT", onSigint);
			process.off("SIGTERM", onSigterm);
		});
	});
}
