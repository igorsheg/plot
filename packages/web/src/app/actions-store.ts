import type {
	OperatorObservationInput,
	SourceActionInput,
} from "@plot/session/runtime";
import { computed } from "nanostores";
import {
	cancelSourceAction,
	recordObservation,
	startSourceAction,
	stopRun,
} from "../data/api.js";
import { createMutatorStore } from "../data/query.js";
import { runsUrl } from "../data/routes.js";
import { $selectedRun } from "./runs-store.js";

export const $stopSelectedRun = createMutatorStore<void, void>(
	async ({ revalidate }) => {
		const run = $selectedRun.get();
		if (run === undefined) return;
		await stopRun(run.id);
		revalidate(runsUrl);
	},
);

export const stopSelectedRun = (): Promise<void> => $stopSelectedRun.mutate();

export const $actOnWork = createMutatorStore<
	Omit<OperatorObservationInput, "actor">
>(async ({ data }) => {
	const run = $selectedRun.get();
	if (run === undefined) return;
	await recordObservation(run.id, data);
});

export const $actOnSource = createMutatorStore<SourceActionInput>(
	async ({ data }) => {
		const run = $selectedRun.get();
		if (run === undefined) return;
		await startSourceAction(run.id, data);
	},
);

export const $cancelSourceAction = createMutatorStore<string>(
	async ({ data: actionRunId }) => {
		const run = $selectedRun.get();
		if (run === undefined) return;
		await cancelSourceAction(run.id, actionRunId);
	},
);

const errorText = (caught: unknown): string =>
	caught instanceof Error ? caught.message : String(caught);

export const actionError = computed(
	[$stopSelectedRun, $actOnWork, $actOnSource, $cancelSourceAction],
	(stop, act, source, cancel): string | undefined =>
		stop.error !== undefined
			? errorText(stop.error)
			: act.error !== undefined
				? errorText(act.error)
				: source.error !== undefined
					? errorText(source.error)
					: cancel.error !== undefined
						? errorText(cancel.error)
						: undefined,
);
