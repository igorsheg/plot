import type { Meta, StoryObj } from "@storybook/react-vite";
import { Text } from "../ui/text.js";
import { ThroughputSparkline } from "./throughput-sparkline.js";

const meta = {
	title: "Session/Throughput Sparkline",
	component: ThroughputSparkline,
	parameters: { layout: "padded" },
} satisfies Meta<typeof ThroughputSparkline>;

export default meta;

const SAMPLES: readonly { graph: string; note: string }[] = [
	{ graph: "▁▁▁▁▁▁▁▁", note: "idle" },
	{ graph: "▁▂▃▄▅▆▇█", note: "ramping up" },
	{ graph: "▇█▆█▇█▆▇", note: "sustained" },
	{ graph: "█▇▅▄▃▂▁▁", note: "winding down" },
];

/** The 8-bucket live strip across its range of shapes. */
export const Samples: StoryObj = {
	render: () => (
		<div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
			{SAMPLES.map(({ graph, note }) => (
				<div
					key={note}
					style={{ display: "flex", alignItems: "center", gap: 20 }}
				>
					<ThroughputSparkline graph={graph} />
					<Text variant="secondary" size="sm">
						{note}
					</Text>
				</div>
			))}
		</div>
	),
};
