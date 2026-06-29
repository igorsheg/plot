import type { SourceId } from "@plot/agent/model";
import { logWideEvent } from "@plot/common/observability";
import { errorMessage } from "@plot/common/primitives";
import type { MaybePromise } from "../sdk.js";

export class PlotExtensionSourceError extends Error {
	override readonly name = "PlotExtensionSourceError";
	readonly phase: "load" | "config" | "create" | "discover" | "hook";
	readonly source?: string;

	constructor(input: {
		readonly phase: PlotExtensionSourceError["phase"];
		readonly message: string;
		readonly source?: string;
	}) {
		super(input.message);
		this.phase = input.phase;
		if (input.source !== undefined) this.source = input.source;
	}
}

export const runMaybePromise = async <A>(
	phase: PlotExtensionSourceError["phase"],
	source: string | undefined,
	thunk: () => MaybePromise<A>,
): Promise<A> => {
	try {
		return await Promise.resolve(thunk());
	} catch (error) {
		throw new PlotExtensionSourceError({
			phase,
			message: errorMessage(error),
			...(source === undefined ? {} : { source }),
		});
	}
};

export const logHookError = (error: unknown, hook: string, source: SourceId) =>
	logWideEvent(
		{
			operation: "plot_extension.hook",
			outcome: "error",
			hook,
			source_id: source,
			error: errorMessage(error),
		},
		"error",
	);
