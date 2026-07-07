import { computed } from "nanostores";
import { $projectionBaselineQuery } from "./projection-store.js";
import { $runsQuery } from "./runs-store.js";
import { actionError } from "./actions-store.js";

const errorText = (caught: unknown): string =>
	caught instanceof Error ? caught.message : String(caught);

export const $plotError = computed(
	[$runsQuery, $projectionBaselineQuery, actionError],
	(runs, projection, action): string | undefined =>
		runs.error !== undefined
			? errorText(runs.error)
			: projection.error !== undefined
				? errorText(projection.error)
				: action,
);
