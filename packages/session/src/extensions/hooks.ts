import type { Completion } from "@plot/agent/model";
import type { PlotExtensionRuntime, PlotExtensionWork } from "../sdk.js";
import { logHookError, runMaybePromise } from "./errors.js";
import { decodeDiscoveredWorks } from "./work.js";

export const discover = async (input: {
	readonly runtime: PlotExtensionRuntime;
	readonly source: string;
	readonly signal: AbortSignal;
}): Promise<readonly PlotExtensionWork[]> =>
	decodeDiscoveredWorks(
		await runMaybePromise("discover", String(input.source), () =>
			input.runtime.discover({ signal: input.signal }),
		),
		String(input.source),
	);

export const invokeOperatorActionHook = async (
	runtime: PlotExtensionRuntime,
	source: string,
	work: PlotExtensionWork,
	data: Record<string, unknown>,
) => {
	try {
		const actionId = data["actionId"];
		const actionLabel = data["actionLabel"];
		const timestamp = data["timestamp"];
		if (
			typeof actionId !== "string" ||
			typeof actionLabel !== "string" ||
			typeof timestamp !== "string"
		)
			return;
		await runtime.operatorAction?.({
			work,
			actionId,
			actionLabel,
			timestamp,
			...(typeof data["comment"] === "string"
				? { comment: data["comment"] }
				: {}),
			...(typeof data["clientId"] === "string"
				? { clientId: data["clientId"] }
				: {}),
			...(data["actor"] === undefined ? {} : { actor: data["actor"] }),
		});
	} catch (error) {
		await logHookError(error, "operator_action", source);
	}
};

export const invokeCompletionHook = async (
	runtime: PlotExtensionRuntime,
	source: string,
	work: PlotExtensionWork,
	completion: Completion,
) => {
	const runId = String(completion.runId);
	try {
		if (completion.status === "succeeded")
			await runtime.completed?.({
				work,
				runId,
				...(completion.output === undefined
					? {}
					: { output: completion.output }),
			});
		else if (completion.status === "failed")
			await runtime.failed?.({
				work,
				runId,
				error: completion.error ?? completion.status,
			});
		else if (completion.status === "timed_out")
			await runtime.timedOut?.({ work, runId });
		else await runtime.interrupted?.({ work, runId });
	} catch (error) {
		await logHookError(error, completion.status, source);
	}
};
