import type { TrackerPluginConfig } from "@plot/sdk";

export interface CommonTrackerConfig {
	kind: string;
	githubRepo?: string;
	dispatchStates?: ReadonlyArray<string>;
	parkedStates?: ReadonlyArray<string>;
	terminalStates?: ReadonlyArray<string>;
}

export function validateCommonTrackerFields(
	raw: TrackerPluginConfig,
): CommonTrackerConfig {
	return {
		kind: String(raw.kind),
		githubRepo:
			typeof raw["githubRepo"] === "string" ? raw["githubRepo"] : undefined,
		dispatchStates: Array.isArray(raw["dispatchStates"])
			? raw["dispatchStates"]
			: undefined,
		parkedStates: Array.isArray(raw["parkedStates"])
			? raw["parkedStates"]
			: undefined,
		terminalStates: Array.isArray(raw["terminalStates"])
			? raw["terminalStates"]
			: undefined,
	};
}

export function deriveAllStates(
	dispatch?: ReadonlyArray<string>,
	parked?: ReadonlyArray<string>,
	terminal?: ReadonlyArray<string>,
): ReadonlyArray<string> {
	return [...(dispatch ?? []), ...(parked ?? []), ...(terminal ?? [])].filter(
		(state, index, states) => states.indexOf(state) === index,
	);
}
