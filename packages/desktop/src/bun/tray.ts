import { Tray } from "electrobun/bun";
import type { ProjectInfo, ProjectStatus } from "../shared/rpc";

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
	onConfigure: (id: string) => void;
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
	const tray = new Tray({ title: "Plot" });
	let projects: ProjectInfo[] = [];

	function buildMenu() {
		const items = [];

		for (const p of projects) {
			const isActive =
				p.status === "streaming" || p.status === "launching" || p.status === "connecting";
			const statusText =
				isActive && p.agentCount > 0
					? `${p.agentCount} agent${p.agentCount !== 1 ? "s" : ""}`
					: p.status;

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
		items.push(divider());
		items.push(normal("Quit Plot", "quit"));

		tray.setMenu(items);
	}

	function updateTitle() {
		const running = projects.filter((p) => p.status === "streaming").length;
		tray.setTitle(running > 0 ? `Plot (${running})` : "Plot");
	}

	tray.on("tray-clicked", (e) => {
		const { action } = (e as { data: { action: string } }).data;
		if (!action) {
			buildMenu();
			return;
		}

		if (action === "add-project") return opts.onAddProject();
		if (action === "quit") return opts.onQuit();
		if (action === "start-all") return opts.onStartAll();
		if (action === "stop-all") return opts.onStopAll();

		const colonIdx = action.indexOf(":");
		if (colonIdx === -1) return;
		const cmd = action.slice(0, colonIdx);
		const id = action.slice(colonIdx + 1);

		switch (cmd) {
			case "configure":
				return opts.onConfigure(id);
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
		refresh(infos: ProjectInfo[]) {
			projects = infos;
			buildMenu();
			updateTitle();
		},
	};
}
