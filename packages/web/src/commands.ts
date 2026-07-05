import type { WorkItemProjection } from "@plot/session/projection";
import type { ObservationInput, WebDashboardProjection } from "./api.js";
import type { FleetStream } from "./derive-fleet.js";
import { laneOf } from "./lanes.js";
import { workOperatorActions } from "./work-card.js";

export type CommandGroup = "Streams" | "Work" | "Actions" | "Time" | "System";

export type PaletteCommand =
	| {
			readonly id: string;
			readonly group: CommandGroup;
			readonly label: string;
			readonly kind: "open-stream";
			readonly streamKey: string;
	  }
	| {
			readonly id: string;
			readonly group: CommandGroup;
			readonly label: string;
			readonly kind: "inspect-work";
			readonly workKey: string;
	  }
	| {
			readonly id: string;
			readonly group: CommandGroup;
			readonly label: string;
			readonly kind: "run-action";
			readonly input: ObservationInput;
	  }
	| {
			readonly id: string;
			readonly group: CommandGroup;
			readonly label: string;
			readonly kind: "jump-time";
			readonly targetMs: number | undefined;
	  }
	| {
			readonly id: string;
			readonly group: CommandGroup;
			readonly label: string;
			readonly kind: "toggle-theme";
	  };

export const commandGroups: readonly CommandGroup[] = [
	"Streams",
	"Work",
	"Actions",
	"Time",
	"System",
];

export const fuzzyMatch = (query: string, value: string): boolean => {
	let index = 0;
	const needle = query.trim().toLocaleLowerCase();
	const haystack = value.toLocaleLowerCase();
	if (needle === "") return true;
	for (const char of haystack) {
		if (char === needle[index]) index += 1;
		if (index === needle.length) return true;
	}
	return false;
};

const titleOf = (work: WorkItemProjection): string =>
	work.title || work.workKey;

const actionInput = (
	work: WorkItemProjection,
	action: ReturnType<typeof workOperatorActions>[number],
): ObservationInput => ({
	sourceId: work.sourceId,
	workKey: work.workKey,
	actionId: action.id,
	actionLabel: action.label,
});

export const buildCommands = ({
	anchorMs,
	nowMs,
	projection,
	streams,
}: {
	readonly anchorMs?: number | undefined;
	readonly nowMs: number;
	readonly projection?: WebDashboardProjection | undefined;
	readonly streams: readonly FleetStream[];
}): readonly PaletteCommand[] => {
	const commands: PaletteCommand[] = streams.map((stream) => ({
		id: `stream:${stream.key}`,
		group: "Streams",
		label: `open ${stream.name}`,
		kind: "open-stream",
		streamKey: stream.key,
	}));
	const workItems = Object.values(projection?.work ?? {}).toSorted(
		(left, right) => titleOf(left).localeCompare(titleOf(right)),
	);
	for (const work of workItems) {
		commands.push({
			id: `work:${work.workKey}`,
			group: "Work",
			label: `inspect ${titleOf(work)}`,
			kind: "inspect-work",
			workKey: work.workKey,
		});
	}
	for (const work of workItems) {
		if (laneOf(work.status) !== "needs-you") continue;
		for (const action of workOperatorActions(work)) {
			if (action.disabledReason !== undefined || action.confirm !== undefined)
				continue;
			commands.push({
				id: `action:${work.workKey}:${action.id}`,
				group: "Actions",
				label: `${action.label} — ${titleOf(work)}`,
				kind: "run-action",
				input: actionInput(work, action),
			});
		}
	}
	if (projection !== undefined) {
		if (anchorMs !== undefined) {
			commands.push({
				id: "time:since-left",
				group: "Time",
				label: "jump to since you left",
				kind: "jump-time",
				targetMs: anchorMs,
			});
		}
		commands.push(
			{
				id: "time:1h",
				group: "Time",
				label: "jump to 1 hour ago",
				kind: "jump-time",
				targetMs: nowMs - 3_600_000,
			},
			{
				id: "time:6h",
				group: "Time",
				label: "jump to last night (6h)",
				kind: "jump-time",
				targetMs: nowMs - 21_600_000,
			},
			{
				id: "time:now",
				group: "Time",
				label: "return to now",
				kind: "jump-time",
				targetMs: undefined,
			},
		);
	}
	commands.push({
		id: "system:theme",
		group: "System",
		label: "toggle theme",
		kind: "toggle-theme",
	});
	return commands;
};

export const filterCommands = (
	commands: readonly PaletteCommand[],
	query: string,
): readonly PaletteCommand[] =>
	commands.filter((command) => fuzzyMatch(query, command.label));
