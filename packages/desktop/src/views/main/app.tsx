import { use } from "react";
import { AppContext, AppProvider } from "./context/app-context";
import { Setup } from "./components/setup";
import { Settings } from "./components/settings";
import { GlobalSettings } from "./components/global-settings";
import { WindowChrome } from "./components/window-chrome";
import { Spinner } from "@plot/ui/components/spinner";

function getView(): "settings" | "project" {
	const params = new URLSearchParams(window.location.search);
	return params.get("view") === "settings" ? "settings" : "project";
}

export function App() {
	const view = getView();

	if (view === "settings") {
		return <GlobalSettings />;
	}

	return (
		<AppProvider>
			<AppShell />
		</AppProvider>
	);
}

function AppShell() {
	const { state } = use(AppContext)!;

	if (state.loading) {
		return (
			<WindowChrome.Root>
				<WindowChrome.Titlebar>
					<WindowChrome.Controls />
				</WindowChrome.Titlebar>
				<WindowChrome.Content className="flex items-center justify-center">
					<Spinner />
				</WindowChrome.Content>
			</WindowChrome.Root>
		);
	}

	const project = state.project;
	if (!project) {
		return (
			<WindowChrome.Root>
				<WindowChrome.Titlebar>
					<WindowChrome.Controls />
				</WindowChrome.Titlebar>
				<WindowChrome.Content className="flex items-center justify-center">
					<p className="text-xs text-muted-foreground">No project selected</p>
				</WindowChrome.Content>
			</WindowChrome.Root>
		);
	}

	if (project.hasWorkflow) {
		return <Settings />;
	}

	return (
		<WindowChrome.Root>
			<WindowChrome.Titlebar>
				<WindowChrome.Controls />
				<span className="text-xs font-medium text-foreground/50 justify-self-center">
					{project.name}
				</span>
			</WindowChrome.Titlebar>
			<WindowChrome.Content>
				<div className="flex flex-1 flex-col min-h-0 view-enter">
					<Setup />
				</div>
			</WindowChrome.Content>
		</WindowChrome.Root>
	);
}
