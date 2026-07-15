import type { Meta, StoryObj } from "@storybook/react-vite";
import { type ReactNode, useState } from "react";
import { SessionDockProvider } from "./session-dock/context.js";
import { SessionDock } from "./session-dock/session-dock.js";
import { SessionHeaderProvider } from "./session-header/context.js";
import { SessionHeader } from "./session-header/session-header.js";
import { SessionNav, SessionNavHeader } from "./session-nav/session-nav.js";
import {
	storySessionHeader,
	storySessionWork,
	storyWorkDetail,
	STORY_NOW,
} from "./story-fixtures.js";
import { SessionWorkProvider } from "./session-work/context.js";
import { WorkDetailProvider } from "./session-work/detail-context.js";
import { SessionBoard } from "./session-work/session-board.js";
import { SessionWork } from "./session-work/session-work.js";
import { Button } from "./ui/button.js";
import { CircleHalfTiltIcon, KanbanIcon, ListDashesIcon } from "./ui/icons.js";
import { ScrollArea } from "./ui/scroll-area.js";
import { Tabs, TabsList, TabsPanel, TabsTab } from "./ui/tabs.js";
import { Text } from "./ui/text.js";

const meta = {
	title: "Screens/Fleet",
	parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;

const workflows = [
	{ key: "pr-review", title: "pr-review" },
	{ key: "debug-flake", title: "debug-flake" },
] as const;

const dockValue = {
	state: {
		live: [
			{
				id: "pr-review",
				title: "pr-review",
				place: "epic",
				selected: true,
				attention: false,
			},
			{
				id: "debug-flake",
				title: "debug-flake",
				place: "epic",
				selected: false,
				attention: true,
			},
		],
		past: [],
		expanded: false,
		nowMs: STORY_NOW,
	},
	actions: { select: () => {}, toggleExpanded: () => {} },
} as const;

function ThemeStandIn() {
	return (
		<Button aria-label="Theme: system" size="icon-sm" variant="ghost">
			<CircleHalfTiltIcon />
		</Button>
	);
}

function LayoutStandIn({ layout }: { readonly layout: "river" | "board" }) {
	const Icon = layout === "river" ? ListDashesIcon : KanbanIcon;
	const next = layout === "river" ? "board" : "river";
	return (
		<Button
			aria-label={`Layout: ${layout}; switch to ${next}`}
			size="icon-sm"
			variant="ghost"
		>
			<Icon />
		</Button>
	);
}

function WorkProviders({ children }: { readonly children: ReactNode }) {
	return (
		<SessionWorkProvider value={storySessionWork}>
			<WorkDetailProvider value={storyWorkDetail(undefined)}>
				{children}
			</WorkDetailProvider>
		</SessionWorkProvider>
	);
}

/** The production river composition: dock, document header, and work stream. */
export const River: StoryObj = {
	render: () => (
		<div className="relative flex h-dvh overflow-hidden bg-background text-foreground">
			<div className="fixed top-1/2 left-0 z-40 -translate-y-1/2 pl-[var(--plot-space-4)]">
				<SessionDockProvider value={dockValue}>
					<SessionDock />
				</SessionDockProvider>
			</div>
			<div className="fixed top-[var(--plot-space-4)] left-[var(--plot-space-4)] z-40 flex items-center gap-1">
				<ThemeStandIn />
				<LayoutStandIn layout="river" />
			</div>
			<main className="min-w-0 flex-1 overflow-y-auto pl-[calc(var(--plot-rhythm)*20)]">
				<div className="min-h-full px-[var(--plot-space-8)] pt-[var(--plot-page-top)] pb-[var(--plot-page-bottom)]">
					<div className="mx-auto flex w-full max-w-[calc(var(--plot-rhythm)*208)] flex-col gap-12">
						<SessionHeaderProvider value={storySessionHeader("online")}>
							<SessionHeader />
						</SessionHeaderProvider>
						<WorkProviders>
							<SessionWork />
						</WorkProviders>
					</div>
				</div>
			</main>
		</div>
	),
};

function BoardScreen() {
	const [selected, setSelected] = useState<string>(workflows[0].key);
	const workflow =
		workflows.find((item) => item.key === selected) ?? workflows[0];
	return (
		<Tabs
			className="h-dvh min-h-0 gap-0 bg-background text-foreground"
			onValueChange={(value) => setSelected(String(value))}
			value={selected}
		>
			<SessionHeaderProvider
				value={storySessionHeader("online", workflow.title)}
			>
				<SessionNavHeader>
					<ThemeStandIn />
					<LayoutStandIn layout="board" />
				</SessionNavHeader>
			</SessionHeaderProvider>
			<SessionNav.Band>
				<TabsList aria-label="Workflows" className="w-max">
					{workflows.map((item) => (
						<TabsTab key={item.key} value={item.key}>
							<Text as="span" size="sm">
								{item.title}
							</Text>
						</TabsTab>
					))}
				</TabsList>
			</SessionNav.Band>
			{workflows.map((item) => (
				<TabsPanel
					className="min-h-0 overflow-hidden"
					key={item.key}
					value={item.key}
				>
					<ScrollArea scrollFade scrollbarGutter>
						<div className="min-h-full px-[var(--plot-space-6)] pt-[var(--plot-space-6)] pb-[var(--plot-page-bottom)]">
							<WorkProviders>
								<SessionBoard />
							</WorkProviders>
						</div>
					</ScrollArea>
				</TabsPanel>
			))}
		</Tabs>
	);
}

/** Session nav and Workflow tabs above the full work board. */
export const Board: StoryObj = {
	render: () => <BoardScreen />,
};
