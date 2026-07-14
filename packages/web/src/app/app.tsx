import { useStore } from "@nanostores/react";
import type { SessionSummary } from "@plot/session-manager/session";
import {
	SessionBoardMain,
	SessionMain,
} from "../components/session-document.js";
import {
	SessionDock,
	StoreSessionDockProvider,
} from "../components/session-dock/session-dock.js";
import { StoreSessionHeaderProvider } from "../components/session-header/session-header.js";
import {
	SessionNav,
	SessionNavHeader,
} from "../components/session-nav/session-nav.js";
import Stack from "../components/ui/stack.js";
import { Tabs, TabsList, TabsPanel, TabsTab } from "../components/ui/tabs.js";
import { Text } from "../components/ui/text.js";
import { ThemeToggle } from "../theme/theme.js";
import { $layoutMode } from "./layout-store.js";
import { LayoutToggle } from "./layout-toggle.js";
import {
	$selectedSession,
	$workflowTabSessions,
	displayName,
	selectWorkflow,
} from "./sessions-store.js";
import {
	appShellClass,
	controlsAnchorClass,
	dockAnchorClass,
} from "./styles.js";

function ShellControls() {
	return (
		<>
			<ThemeToggle />
			<LayoutToggle />
		</>
	);
}

function RiverLayout() {
	return (
		<Stack className={appShellClass()}>
			<div className={dockAnchorClass()}>
				<StoreSessionDockProvider>
					<SessionDock />
				</StoreSessionDockProvider>
			</div>
			<SessionMain />
			<div className={controlsAnchorClass()}>
				<ShellControls />
			</div>
		</Stack>
	);
}

function EmptyBoardLayout() {
	return (
		<Stack className={appShellClass()} direction="column">
			<SessionNav.Root>
				<SessionNav.Identity>
					<SessionNav.Title>Plot workflows</SessionNav.Title>
					<SessionNav.Meta>No active sessions</SessionNav.Meta>
				</SessionNav.Identity>
				<SessionNav.Actions>
					<ShellControls />
				</SessionNav.Actions>
			</SessionNav.Root>
			<main className="flex min-h-0 flex-1 items-center justify-center px-[var(--plot-space-8)]">
				<Text as="p" variant="secondary">
					No active sessions. Start a Workflow and it will appear here.
				</Text>
			</main>
		</Stack>
	);
}

function WorkflowTabs({
	workflows,
}: {
	readonly workflows: readonly SessionSummary[];
}) {
	return (
		<SessionNav.Band>
			<TabsList aria-label="Workflows" className="w-max">
				{workflows.map((session) => (
					<TabsTab key={session.workflowKey} value={session.workflowKey}>
						<Text as="span" size="sm">
							{displayName(session)}
						</Text>
					</TabsTab>
				))}
			</TabsList>
		</SessionNav.Band>
	);
}

function BoardSessionLayout({
	selected,
	workflows,
	onSelectWorkflow,
}: {
	readonly selected: SessionSummary;
	readonly workflows: readonly SessionSummary[];
	readonly onSelectWorkflow: (workflowKey: string) => void;
}) {
	return (
		<Tabs
			className={appShellClass({ className: "min-h-0 gap-0" })}
			onValueChange={(workflowKey) => onSelectWorkflow(String(workflowKey))}
			value={selected.workflowKey}
		>
			<StoreSessionHeaderProvider>
				<SessionNavHeader>
					<ShellControls />
				</SessionNavHeader>
			</StoreSessionHeaderProvider>
			<WorkflowTabs workflows={workflows} />
			<TabsPanel
				className="min-h-0 overflow-hidden"
				value={selected.workflowKey}
			>
				<SessionBoardMain />
			</TabsPanel>
		</Tabs>
	);
}

function BoardLayout() {
	const selected = useStore($selectedSession);
	const workflows = useStore($workflowTabSessions);
	return selected === undefined ? (
		<EmptyBoardLayout />
	) : (
		<BoardSessionLayout
			onSelectWorkflow={selectWorkflow}
			selected={selected}
			workflows={workflows}
		/>
	);
}

export function PlotApp() {
	const layout = useStore($layoutMode);
	return layout === "river" ? <RiverLayout /> : <BoardLayout />;
}
