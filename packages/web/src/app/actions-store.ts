import type {
	OperatorObservationInput,
	SourceActionInput,
} from "@plot/session/runtime";
import { computed } from "nanostores";
import {
	cancelSourceAction,
	recordObservation,
	startSourceAction,
	stopSession,
} from "../data/api.js";
import { createMutatorStore } from "../data/query.js";
import { sessionsUrl } from "../data/routes.js";
import { $selectedSession } from "./sessions-store.js";

export const $stopSelectedSession = createMutatorStore<void, void>(
	async ({ revalidate }) => {
		const session = $selectedSession.get();
		if (session === undefined) return;
		await stopSession(session.id);
		revalidate(sessionsUrl);
	},
);

export const stopSelectedSession = (): Promise<void> =>
	$stopSelectedSession.mutate();

export const $actOnWork = createMutatorStore<
	Omit<OperatorObservationInput, "actor">
>(async ({ data }) => {
	const session = $selectedSession.get();
	if (session === undefined) return;
	await recordObservation(session.id, data);
});

export const $actOnSource = createMutatorStore<SourceActionInput>(
	async ({ data }) => {
		const session = $selectedSession.get();
		if (session === undefined) return;
		await startSourceAction(session.id, data);
	},
);

export const $cancelSourceAction = createMutatorStore<string>(
	async ({ data: actionRunId }) => {
		const session = $selectedSession.get();
		if (session === undefined) return;
		await cancelSourceAction(session.id, actionRunId);
	},
);

const errorText = (caught: unknown): string =>
	caught instanceof Error ? caught.message : String(caught);

export const actionError = computed(
	[$stopSelectedSession, $actOnWork, $actOnSource, $cancelSourceAction],
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
