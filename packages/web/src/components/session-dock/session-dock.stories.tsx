import type { Meta, StoryObj } from "@storybook/react-vite";
import { SessionDock } from "./session-dock.js";
import {
	SessionDockProvider,
	type SessionDockContextValue,
} from "./context.js";
import { DEFAULT_DOCK_MOTION, type DockMotion } from "./motion.js";
import type { DockLineItem } from "./view-model.js";

/**
 * Line navigator with live animation knobs. The whole line — height, title,
 * width, colour — reveals on one shared ease-out; hover a line to feel it, tune
 * enter/exit/curve in the panel. The errored session ("deploy") draws a longer
 * destructive line. Dial it in here, then copy the numbers into
 * `DEFAULT_DOCK_MOTION` in motion.ts.
 */
const meta = {
	title: "Session/Dock",
	parameters: { layout: "fullscreen" },
	args: DEFAULT_DOCK_MOTION,
	argTypes: {
		enterMs: {
			name: "enter (reveal)",
			control: { type: "range", min: 0, max: 600, step: 10 },
			description: "Height grow, title fade/slide, line widen — on hover/focus",
		},
		exitMs: {
			name: "exit (collapse)",
			control: { type: "range", min: 0, max: 600, step: 10 },
			description: "The same, in reverse, on hover/focus out",
		},
		curve: {
			name: "curve (both ways)",
			control: "text",
			description: "One shared cubic-bezier(...) for enter and exit",
		},
	},
} satisfies Meta<DockMotion>;

export default meta;

type Story = StoryObj<DockMotion>;

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

const actions = { select: () => {}, toggleExpanded: () => {} };

function dock(state: SessionDockContextValue["state"]): Story {
	return {
		render: (args) => (
			<SessionDockProvider value={{ state, actions }}>
				<SessionDock motion={args} />
			</SessionDockProvider>
		),
	};
}

/** Selected reads its title; others are hairlines that reveal on hover. */
export const Default = dock({ live, past, expanded: false, nowMs: NOW });

/** Past group revealed. */
export const Expanded = dock({ live, past, expanded: true, nowMs: NOW });
