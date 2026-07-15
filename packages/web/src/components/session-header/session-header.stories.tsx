import type { Meta, StoryObj } from "@storybook/react-vite";
import type { SessionState } from "@plot/session-manager/session";
import type { ReactNode } from "react";
import { storySessionHeader } from "../story-fixtures.js";
import { SessionNav, SessionNavHeader } from "../session-nav/session-nav.js";
import { Button } from "../ui/button.js";
import { KanbanIcon, MoonIcon } from "../ui/icons.js";
import { Text } from "../ui/text.js";
import { SessionHeaderProvider } from "./context.js";
import { SessionHeader } from "./session-header.js";

const meta = {
	title: "Components/Session chrome",
	parameters: { layout: "padded" },
} satisfies Meta;

export default meta;

const statuses: readonly SessionState[] = [
	"online",
	"starting",
	"error",
	"stopped",
];

function Specimen({
	status,
	children,
}: {
	readonly status: SessionState;
	readonly children: ReactNode;
}) {
	return (
		<section className="flex flex-col gap-3">
			<Text as="h2" size="sm" variant="mono-secondary">
				{status}
			</Text>
			{children}
		</section>
	);
}

/** River document header across the complete Session lifecycle. */
export const RiverHeader: StoryObj = {
	render: () => (
		<div className="flex max-w-3xl flex-col gap-12">
			{statuses.map((status) => (
				<Specimen key={status} status={status}>
					<SessionHeaderProvider value={storySessionHeader(status)}>
						<SessionHeader />
					</SessionHeaderProvider>
				</Specimen>
			))}
		</div>
	),
};

function BoardControls() {
	return (
		<>
			<Button aria-label="Theme: dark" size="icon-sm" variant="ghost">
				<MoonIcon />
			</Button>
			<Button
				aria-label="Layout: board; switch to river"
				size="icon-sm"
				variant="ghost"
			>
				<KanbanIcon />
			</Button>
		</>
	);
}

/** Board nav across the same lifecycle, including its attached Workflow band. */
export const BoardNavigation: StoryObj = {
	render: () => (
		<div className="flex flex-col gap-12">
			{statuses.map((status) => (
				<Specimen key={status} status={status}>
					<div>
						<SessionHeaderProvider value={storySessionHeader(status)}>
							<SessionNavHeader>
								<BoardControls />
							</SessionNavHeader>
						</SessionHeaderProvider>
						<SessionNav.Band>
							<Text as="span" size="sm" variant="secondary">
								pr-review · debug-flake
							</Text>
						</SessionNav.Band>
					</div>
				</Specimen>
			))}
		</div>
	),
};
