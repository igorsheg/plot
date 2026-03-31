import { Tray } from "electrobun/bun";
import type { ProjectInfo, ProjectSnapshot, ProjectStatus } from "../shared/rpc";


const statusDot: Record<ProjectStatus, string> = {
	streaming: "●",
	launching: "◐",
	connecting: "◐",
	stopping: "◐",
	idle: "○",
	stopped: "○",
	failed: "⚠",
};

type TrayOpts = {
	onOpen: (projectId?: string) => void;
	onSettings: () => void;
	onStartProject: (id: string) => void;
	onStopProject: (id: string) => void;
	onStartAll: () => void;
	onStopAll: () => void;
	onOpenInFinder: (path: string) => void;
	onRemoveProject: (id: string) => void;
	onAddProject: () => void;
	onQuit: () => void;
};

function normal(label: string, action: string) {
	return { type: "normal" as const, label, action };
}

function divider() {
	return { type: "separator" as const };
}

export function createTray(opts: TrayOpts) {
	const tray = new Tray({ image: "views://tray-icon.svg" });
	let projects: ProjectInfo[] = [];

	let currentSnapshots: Map<string, ProjectSnapshot> | undefined;

	function buildMenu(snapshots?: Map<string, ProjectSnapshot>) {
		const items = [];

		for (const p of projects) {
			const isActive =
				p.status === "streaming" || p.status === "launching" || p.status === "connecting";
			const snapshot = snapshots?.get(p.id);

			let statusText: string;
			if (isActive && snapshot) {
				const agentCount = snapshot.running.length;
				const totalTokens = snapshot.totals.totalTokens;
				const tokenStr = totalTokens >= 1_000_000
					? `${(totalTokens / 1_000_000).toFixed(1)}M`
					: totalTokens >= 1_000
						? `${(totalTokens / 1_000).toFixed(0)}K`
						: `${totalTokens}`;
				statusText = agentCount > 0
					? `${agentCount} agent${agentCount !== 1 ? "s" : ""}  ${tokenStr} tokens`
					: p.status;
			} else if (isActive && p.agentCount > 0) {
				statusText = `${p.agentCount} agent${p.agentCount !== 1 ? "s" : ""}`;
			} else {
				statusText = p.status;
			}

			items.push({
				type: "normal" as const,
				label: `${statusDot[p.status]} ${p.name} — ${statusText}`,
				action: `configure:${p.id}`,
				submenu: [
					normal("Configure...", `configure:${p.id}`),
					divider(),
					...(isActive
						? [normal("Stop", `stop:${p.id}`)]
						: [normal("Start", `start:${p.id}`)]),
					divider(),
					normal("Show in Finder", `finder:${p.id}`),
					normal("Remove", `remove:${p.id}`),
				],
			});
		}

		if (projects.length > 0) {
			items.push(divider());
			const hasActive = projects.some(
				(p) =>
					p.status === "streaming" ||
					p.status === "launching" ||
					p.status === "connecting",
			);
			if (hasActive) items.push(normal("Stop All", "stop-all"));
			items.push(normal("Start All", "start-all"));
		}

		items.push(divider());
		items.push(normal("Add Project...", "add-project"));
		items.push(normal("Settings...", "settings"));
		items.push(divider());
		items.push(normal("Quit Plot", "quit"));

		tray.setMenu(items);
	}

	function updateTitle() {
		const running = projects.filter((p) => p.status === "streaming").length;
		tray.setTitle(running > 0 ? `${running}` : "");
	}

	tray.on("tray-clicked", (e) => {
		const { action } = (e as { data: { action: string } }).data;
		if (!action) {
			buildMenu(currentSnapshots);
			return;
		}

		if (action === "add-project") return opts.onAddProject();
		if (action === "settings") return opts.onSettings();
		if (action === "quit") return opts.onQuit();
		if (action === "start-all") return opts.onStartAll();
		if (action === "stop-all") return opts.onStopAll();

		const colonIdx = action.indexOf(":");
		if (colonIdx === -1) {
			// Clicking on main tray icon without specific action opens the main window
			return opts.onOpen();
		}
		const cmd = action.slice(0, colonIdx);
		const id = action.slice(colonIdx + 1);

		switch (cmd) {
			case "configure":
				return opts.onOpen(id);
			case "start":
				return opts.onStartProject(id);
			case "stop":
				return opts.onStopProject(id);
			case "remove":
				return opts.onRemoveProject(id);
			case "finder": {
				const p = projects.find((proj) => proj.id === id);
				if (p) opts.onOpenInFinder(p.path);
				return;
			}
		}
	});

	return {
		refresh(infos: ProjectInfo[], snapshots?: Map<string, ProjectSnapshot>) {
			projects = infos;
			currentSnapshots = snapshots;
			buildMenu(snapshots);
			updateTitle();
		},
	};
}
