/**
 * Module-local wiring for the work drawer's open state. `$openDetail` is the one
 * source of truth for "which item is the drawer showing"; `$detailView` derives
 * the rendered view from it and the live projection (re-resolving every $nowMs
 * tick so ages stay live, and following a work item into `completed` when it
 * settles). The open/close/step helpers own `$openDetail`. This is the only
 * session-work file that reaches into app stores — the rows and drawer never do.
 */

import { atom, computed } from "nanostores";
import { $selectedProjection } from "../../app/projection-store.js";
import { $selectedRunId } from "../../app/runs-store.js";
import { $nowMs } from "../../app/time-store.js";
import {
	buildDetail,
	openableRefs,
	stepRef,
	type DetailRef,
	type DetailView,
} from "./detail-view-model.js";
import { buildAttention, buildMotion, buildSettled } from "./view-model.js";

export const $openDetail = atom<DetailRef | undefined>(undefined);

export const $detailView = computed(
	[$selectedProjection, $openDetail, $nowMs],
	(projection, ref, nowMs): DetailView | undefined =>
		projection === undefined || ref === undefined
			? undefined
			: buildDetail(projection, ref, nowMs),
);

export const openDetail = (ref: DetailRef): void => {
	$openDetail.set(ref);
};

export const closeDetail = (): void => {
	$openDetail.set(undefined);
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

// Switching sessions closes the drawer; transient unresolved projection state does
// not. `$openDetail` is the durable UI intent, while `$detailView` is only the
// currently resolvable content for that intent.
$selectedRunId.listen(() => closeDetail());
