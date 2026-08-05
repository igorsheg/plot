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
import { $selectedSessionId } from "../../app/sessions-store.js";
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
/** One-step parent when a Subject drawer opens one of its children. */
export const $detailReturn = atom<DetailRef | undefined>(undefined);

export const $detailView = computed(
	[$selectedProjection, $openDetail, $nowMs],
	(projection, ref, nowMs): DetailView | undefined =>
		projection === undefined || ref === undefined
			? undefined
			: buildDetail(projection, ref, nowMs),
);

export const openDetail = (ref: DetailRef): void => {
	const current = $openDetail.get();
	$detailReturn.set(
		current?.kind === "subject" && ref.kind === "work" ? current : undefined,
	);
	$openDetail.set(ref);
};

export const backDetail = (): void => {
	const ref = $detailReturn.get();
	if (ref === undefined) return;
	$detailReturn.set(undefined);
	$openDetail.set(ref);
};

export const closeDetail = (): void => {
	$detailReturn.set(undefined);
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
	if (next === undefined) return;
	$detailReturn.set(undefined);
	$openDetail.set(next);
};

// Switching sessions closes the drawer; transient unresolved projection state does
// not. `$openDetail` is the durable UI intent, while `$detailView` is only the
// currently resolvable content for that intent.
$selectedSessionId.listen(() => closeDetail());
