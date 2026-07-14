import type { Meta, StoryObj } from "@storybook/react-vite";
import type { WorkState } from "../ui/icons.js";
import { Text } from "../ui/text.js";
import { StateIcon } from "./atoms.js";

const meta = {
	title: "Foundations/Work states",
	parameters: { layout: "padded" },
} satisfies Meta;

export default meta;

const STATES: readonly { state: WorkState; note: string }[] = [
	{ state: "attention", note: "decision or failure" },
	{ state: "active", note: "running now" },
	{ state: "queued", note: "ready to dispatch / wakes later" },
	{ state: "held", note: "waiting on external state" },
	{ state: "history", note: "recent run history" },
];

/** The work-state vocabulary: one vendored glyph per state. */
export const States: StoryObj = {
	render: () => (
		<div style={{ display: "flex", gap: 48, alignItems: "flex-start" }}>
			{STATES.map(({ state, note }) => (
				<div
					key={state}
					style={{ display: "flex", flexDirection: "column", gap: 12 }}
				>
					<StateIcon state={state} />
					<Text variant="mono" size="sm">
						{state}
					</Text>
					<Text variant="secondary" size="sm">
						{note}
					</Text>
				</div>
			))}
		</div>
	),
};
