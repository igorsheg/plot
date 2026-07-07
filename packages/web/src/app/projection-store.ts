import { atom, computed, onMount } from "nanostores";
import type { SerializedDashboardProjection } from "@plot/projection";
import { createFetcherStore } from "../data/query.js";
import {
	projectionMatchesRun,
	reduceSerializedProjection,
} from "../data/projection-client.js";
import { isRunLive } from "../data/run.js";
import { runEventsUrl, runProjectionUrl } from "../data/routes.js";
import { projectionEvents } from "../data/sse.js";
import { $selectedRun } from "./runs-store.js";

const $selectedProjectionUrl = computed($selectedRun, (run) =>
	run === undefined ? null : runProjectionUrl(run),
);

export const $projectionBaselineQuery =
	createFetcherStore<SerializedDashboardProjection>([$selectedProjectionUrl], {
		revalidateOnFocus: true,
	});

export const $selectedProjection = atom<
	SerializedDashboardProjection | undefined
>(undefined);

onMount($selectedProjection, () => {
	let continuation: AbortController | undefined;
	const closeContinuation = () => {
		continuation?.abort();
		continuation = undefined;
	};
	const openContinuation = (
		run: NonNullable<ReturnType<typeof $selectedRun.get>>,
		projection: SerializedDashboardProjection,
	): void => {
		closeContinuation();
		if (!isRunLive(run)) return;
		const controller = new AbortController();
		continuation = controller;
		void (async () => {
			for await (const event of projectionEvents(
				runEventsUrl(run, projection.frontier),
				controller.signal,
			)) {
				const current = $selectedProjection.get();
				if (current !== undefined)
					$selectedProjection.set(reduceSerializedProjection(current, event));
			}
		})().catch(() => undefined);
	};
	const syncBaseline = (): void => {
		const run = $selectedRun.get();
		const projection = $projectionBaselineQuery.get().data;
		if (
			run === undefined ||
			projection === undefined ||
			!projectionMatchesRun(projection, run)
		) {
			closeContinuation();
			$selectedProjection.set(undefined);
			return;
		}
		$selectedProjection.set(projection);
		openContinuation(run, projection);
	};
	const unsubscribeProjection = $projectionBaselineQuery.listen(syncBaseline);
	const unsubscribeRun = $selectedRun.listen(syncBaseline);
	syncBaseline();
	return () => {
		unsubscribeProjection();
		unsubscribeRun();
		closeContinuation();
	};
});
