import { atom, computed, onMount } from "nanostores";
import type { SerializedDashboardProjection } from "@plot/projection";
import { createFetcherStore } from "../data/query.js";
import {
	projectionMatchesSession,
	reduceSerializedProjection,
} from "../data/projection-client.js";
import { isActiveSession } from "../data/session.js";
import { sessionEventsUrl, sessionProjectionUrl } from "../data/routes.js";
import { projectionEvents } from "../data/sse.js";
import { $selectedSession } from "./sessions-store.js";

const $selectedProjectionUrl = computed($selectedSession, (session) =>
	session === undefined ? null : sessionProjectionUrl(session),
);

export const $projectionBaselineQuery =
	createFetcherStore<SerializedDashboardProjection>([$selectedProjectionUrl], {
		revalidateOnFocus: true,
	});

export const $selectedProjection = atom<
	SerializedDashboardProjection | undefined
>(undefined);

export const shouldAcceptProjectionBaseline = (input: {
	readonly current: SerializedDashboardProjection | undefined;
	readonly baseline: SerializedDashboardProjection;
}): boolean =>
	input.current === undefined ||
	input.current.sessionId !== input.baseline.sessionId ||
	input.baseline.frontier >= input.current.frontier;

onMount($selectedProjection, () => {
	let continuation: AbortController | undefined;
	const closeContinuation = () => {
		continuation?.abort();
		continuation = undefined;
	};
	const openContinuation = (
		session: NonNullable<ReturnType<typeof $selectedSession.get>>,
		projection: SerializedDashboardProjection,
	): void => {
		closeContinuation();
		if (!isActiveSession(session)) return;
		const controller = new AbortController();
		continuation = controller;
		void (async () => {
			for await (const event of projectionEvents(
				sessionEventsUrl(session, projection.frontier),
				controller.signal,
			)) {
				if (
					event.kind === "session_event" &&
					event.event.type === "source_interaction_open_url"
				)
					window.open(event.event.url, "_blank", "noopener,noreferrer");
				const current = $selectedProjection.get();
				if (current !== undefined)
					$selectedProjection.set(reduceSerializedProjection(current, event));
			}
		})().catch(() => undefined);
	};
	const syncBaseline = (): void => {
		const session = $selectedSession.get();
		const projection = $projectionBaselineQuery.get().data;
		if (
			session === undefined ||
			projection === undefined ||
			!projectionMatchesSession(projection, session)
		) {
			closeContinuation();
			$selectedProjection.set(undefined);
			return;
		}
		const current = $selectedProjection.get();
		if (!shouldAcceptProjectionBaseline({ current, baseline: projection }))
			return;
		$selectedProjection.set(projection);
		openContinuation(session, projection);
	};
	const unsubscribeProjection = $projectionBaselineQuery.listen(syncBaseline);
	const unsubscribeSession = $selectedSession.listen(syncBaseline);
	syncBaseline();
	return () => {
		unsubscribeProjection();
		unsubscribeSession();
		closeContinuation();
	};
});
