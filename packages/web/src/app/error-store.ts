import { computed } from "nanostores";
import { $projectionBaselineQuery } from "./projection-store.js";
import { $sessionsQuery } from "./sessions-store.js";
import { actionError } from "./actions-store.js";

const errorText = (caught: unknown): string =>
	caught instanceof Error ? caught.message : String(caught);

export const $applicationError = computed(
	[$sessionsQuery, $projectionBaselineQuery, actionError],
	(sessions, projection, action): string | undefined =>
		sessions.error !== undefined
			? errorText(sessions.error)
			: projection.error !== undefined
				? errorText(projection.error)
				: action,
);
