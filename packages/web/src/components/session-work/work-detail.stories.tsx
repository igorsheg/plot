import type { Meta, StoryObj } from "@storybook/react-vite";
import {
	storyDetailViews,
	storySessionWork,
	storyWorkDetail,
} from "../story-fixtures.js";
import { SessionWorkProvider } from "./context.js";
import { WorkDetailProvider } from "./detail-context.js";
import type { DetailView } from "./detail-view-model.js";
import { WorkDetail } from "./work-detail.js";

const meta = {
	title: "Components/Work detail",
	parameters: { layout: "padded" },
} satisfies Meta;

export default meta;

function panel(view: DetailView): StoryObj {
	return {
		render: () => (
			<SessionWorkProvider value={storySessionWork}>
				<WorkDetailProvider value={storyWorkDetail(view)}>
					<div className="h-[40rem] w-[28.75rem] overflow-hidden rounded-xl border border-border bg-background">
						<WorkDetail />
					</div>
				</WorkDetailProvider>
			</SessionWorkProvider>
		),
	};
}

export const Decision = panel(storyDetailViews.decision);
export const Active = panel(storyDetailViews.active);
export const Source = panel(storyDetailViews.source);
export const Settled = panel(storyDetailViews.settled);
export const Failed = panel(storyDetailViews.failed);
