/**
 * Module-local wiring for the work drawer's open state. `$openDetail` is the one
 * source of truth for "which item is the drawer showing"; `$detailView` derives
 * the rendered view from it and the live projection (re-resolving every $nowMs
 * tick so ages stay live, and following a work item into `completed` when it
 * settles). The open/close/step/toggle helpers keep `$openDetail` and the app's
 * `$transcriptRef` in lockstep. This is the only session-work file that reaches
 * into app stores — the rows and drawer never do.
 */

import { atom, computed } from "nanostores";
import { $selectedProjection } from "../../app/projection-store.js";
import { $selectedRun, $selectedRunId } from "../../app/runs-store.js";
import { $nowMs } from "../../app/time-store.js";
import { runTranscriptUrl } from "../../data/routes.js";
import type { TranscriptResult } from "../../data/api.js";
import { createFetcherStore } from "../../data/query.js";
import {
	buildDetail,
	openableRefs,
	stepRef,
	type DetailRef,
	type DetailView,
} from "./detail-view-model.js";
import { buildAttention, buildMotion, buildSettled } from "./view-model.js";

interface TranscriptRef {
	readonly runId: string;
	readonly attemptRunId: string;
}

export const $transcriptRef = atom<TranscriptRef | undefined>(undefined);

const $transcriptUrl = computed($transcriptRef, (ref) =>
	ref === undefined ? null : runTranscriptUrl(ref),
);

export const $transcriptQuery = createFetcherStore<TranscriptResult>([
	$transcriptUrl,
]);

const setTranscriptRef = (ref: TranscriptRef | undefined): void => {
	$transcriptRef.set(ref);
};

export const $openDetail = atom<DetailRef | undefined>(undefined);

export const $detailView = computed(
	[$selectedProjection, $openDetail, $nowMs],
	(projection, ref, nowMs): DetailView | undefined =>
		projection === undefined || ref === undefined
			? undefined
			: buildDetail(projection, ref, nowMs),
);

/** A failed detail arrives with its crash already open; others start collapsed. */
const syncTranscriptForView = (view: DetailView | undefined): void => {
	const run = $selectedRun.get();
	if (
		view?.kind === "failed" &&
		view.attemptRunId !== undefined &&
		run !== undefined
	) {
		setTranscriptRef({ runId: run.id, attemptRunId: view.attemptRunId });
	} else {
		setTranscriptRef(undefined);
	}
};

export const openDetail = (ref: DetailRef): void => {
	$openDetail.set(ref);
	syncTranscriptForView($detailView.get());
};

export const closeDetail = (): void => {
	$openDetail.set(undefined);
	setTranscriptRef(undefined);
};

export const stepDetail = (direction: 1 | -1): void => {
	const projection = $selectedProjection.get();
	if (projection === undefined) return;
	const refs = openableRefs({
		attention: buildAttention(projection),
		motion: buildMotion(projection),
		settled: buildSettled(projection),
	});
	const next = stepRef(refs, $openDetail.get(), direction);
	if (next !== undefined) openDetail(next);
};

export const toggleTranscript = (): void => {
	if ($transcriptRef.get() !== undefined) {
		setTranscriptRef(undefined);
		return;
	}
	const view = $detailView.get();
	const run = $selectedRun.get();
	if (view?.attemptRunId !== undefined && run !== undefined) {
		setTranscriptRef({ runId: run.id, attemptRunId: view.attemptRunId });
	}
};

// Switching sessions closes the drawer; a work item that resolves to nothing
// (gone from both the live map and completed) closes it gracefully.
$selectedRunId.listen(() => closeDetail());
$detailView.listen((view) => {
	if (view === undefined && $openDetail.get() !== undefined) closeDetail();
});
