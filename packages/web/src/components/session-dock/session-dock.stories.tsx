import type { Meta, StoryObj } from "@storybook/react-vite";
import { SessionDock } from "./session-dock.js";
import {
	SessionDockProvider,
	type SessionDockContextValue,
} from "./context.js";
import type { DockLineItem } from "./view-model.js";

const meta = {
	title: "Session/Dock",
	parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;

const NOW = 1_720_000_000_000;

const live: readonly DockLineItem[] = [
	{
		id: "a",
		title: "pr-review",
		place: "epic",
		selected: true,
		attention: false,
	},
	{
		id: "b",
		title: "debug-flake",
		place: "epic",
		selected: false,
		attention: false,
	},
	{
		id: "c",
		title: "deploy",
		place: "infra",
		selected: false,
		attention: true,
	},
];

const past: readonly DockLineItem[] = [
	{
		id: "d",
		title: "migrate-store",
		place: "epic",
		selected: false,
		attention: false,
		stoppedAtMs: NOW - 40 * 60_000,
	},
];

function dock(value: SessionDockContextValue): StoryObj {
	return {
		render: () => (
			<SessionDockProvider value={value}>
				<SessionDock />
			</SessionDockProvider>
		),
	};
}

const actions = { select: () => {}, toggleExpanded: () => {} };

/**
 * Line navigator. Selected reads its title; others are hairlines that reveal on
 * hover. The errored session ("deploy") draws a longer destructive line.
 */
export const Default = dock({
	state: { live, past, expanded: false, nowMs: NOW },
	actions,
});

/** Past group revealed. */
export const Expanded = dock({
	state: { live, past, expanded: true, nowMs: NOW },
	actions,
});
