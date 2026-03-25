import { Tray } from "electrobun/bun";
import type { ProjectInfo } from "../shared/types";

const statusEmoji: Record<ProjectInfo["status"], string> = {
	running: "●",
	starting: "●",
	idle: "○",
	stopped: "○",
	error: "⚠",
};

const trayTitle: Record<TrayStatus, string> = {
	idle: "Plot",
	running: "Plot ●",
	error: "Plot ⚠",
};

type TrayStatus = "idle" | "running" | "error";

type TrayOpts = {
	onProjectClick: (path: string) => void;
	onAddProject: () => void;
	onQuit: () => void;
};

type TrayController = {
	updateProjects: (projects: ProjectInfo[]) => void;
	setStatus: (status: TrayStatus) => void;
};

const PROJECT_ACTION_PREFIX = "project:";
const ADD_PROJECT_ACTION = "add-project";
const QUIT_ACTION = "quit";

export function createTray(opts: TrayOpts): TrayController {
	const tray = new Tray({ title: "Plot" });

	tray.on("tray-clicked", (e) => {
		const { action } = (e as { data: { action: string } }).data;
		if (action.startsWith(PROJECT_ACTION_PREFIX)) {
			opts.onProjectClick(action.slice(PROJECT_ACTION_PREFIX.length));
		} else if (action === ADD_PROJECT_ACTION) {
			opts.onAddProject();
		} else if (action === QUIT_ACTION) {
			opts.onQuit();
		}
	});

	return {
		updateProjects(projects) {
			tray.setMenu([
				...projects.map((p) => ({
					type: "normal" as const,
					label: `${p.name} — ${statusEmoji[p.status]}`,
					action: `${PROJECT_ACTION_PREFIX}${p.path}`,
				})),
				{ type: "separator" as const },
				{ type: "normal" as const, label: "Add Project...", action: ADD_PROJECT_ACTION },
				{ type: "normal" as const, label: "Quit", action: QUIT_ACTION },
			]);
		},

		setStatus(status) {
			tray.setTitle(trayTitle[status]);
		},
	};
}
