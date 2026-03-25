import { BrowserWindow, BrowserView, Utils, ApplicationMenu } from "electrobun/bun";
import type { DesktopRPC, ProjectInfo } from "../shared/types";
import { createTray } from "./tray";
import { ProcessManager } from "./process-manager";
import {
	loadProjectList,
	addProject,
	removeProject,
	readWorkflowFile,
	saveWorkflowFile,
} from "./file-io";

const DEV_PORT = 5174;
const DEV_URL = `http://localhost:${DEV_PORT}`;

async function getViewUrl(): Promise<string> {
	try {
		await fetch(DEV_URL, { method: "HEAD" });
		console.log(`HMR: loading from ${DEV_URL}`);
		return DEV_URL;
	} catch {
		return "views://main/index.html";
	}
}

ApplicationMenu.setApplicationMenu([
	{
		submenu: [{ role: "quit" }],
	},
	{
		label: "Edit",
		submenu: [
			{ role: "undo" },
			{ role: "redo" },
			{ type: "separator" },
			{ role: "cut" },
			{ role: "copy" },
			{ role: "paste" },
			{ role: "selectAll" },
		],
	},
]);

const processManager = new ProcessManager();

const rpc = BrowserView.defineRPC<DesktopRPC>({
	handlers: {
		requests: {
			async listProjects() {
				const entries = await loadProjectList();
				return entries.map<ProjectInfo>((e) => ({
					path: e.path,
					name: e.name,
					status: processManager.getStatus(e.path),
				}));
			},

			async addProject({ path: folderPath }) {
				try {
					const entry = await addProject(folderPath);
					return {
						path: entry.path,
						name: entry.name,
						status: processManager.getStatus(entry.path),
					} satisfies ProjectInfo;
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					return { path: folderPath, name: folderPath, status: "error", error: msg } satisfies ProjectInfo;
				}
			},

			async removeProject({ path: folderPath }) {
				await removeProject(folderPath);
				return true;
			},

			async readWorkflow({ projectPath }) {
				try {
					return await readWorkflowFile(projectPath);
				} catch (err) {
					return null;
				}
			},

			async saveWorkflow({ projectPath, workflow }) {
				try {
					await saveWorkflowFile(projectPath, workflow);
					return true;
				} catch (err) {
					return false;
				}
			},

			async startAgent({ projectPath }) {
				try {
					const pid = await processManager.start(
						projectPath,
						projectPath + "/WORKFLOW.md",
					);
					return { pid };
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					win.webview.rpc!.send.agentStatusUpdate({ projectPath, status: "error", error: msg });
					return { pid: -1 };
				}
			},

			async stopAgent({ projectPath }) {
				await processManager.stop(projectPath);
				return true;
			},

			async getAgentStatus({ projectPath }) {
				return processManager.getStatus(projectPath);
			},

			async pickFolder() {
				const chosen = await Utils.openFileDialog({
					canChooseFiles: false,
					canChooseDirectory: true,
					allowsMultipleSelection: false,
				});
				return chosen && chosen.length > 0 ? chosen[0] : null;
			},
		},
		messages: {},
	},
});

const win = new BrowserWindow({
	title: "Plot",
	url: await getViewUrl(),
	titleBarStyle: "hiddenInset",
	rpc,
	frame: {
		width: 520,
		height: 760,
		x: 100,
		y: 100,
	},
});

const tray = createTray({
	onProjectClick: () => win.focus(),
	onAddProject: () => win.focus(),
	onQuit: () => process.exit(0),
});

processManager.onStatusChange((projectPath, status, error) => {
	win.webview.rpc!.send.agentStatusUpdate({ projectPath, status, error });
});

processManager.onLog((projectPath, line) => {
	win.webview.rpc!.send.agentLog({ projectPath, line });
});

processManager.onExit((projectPath, code) => {
	win.webview.rpc!.send.processExited({ projectPath, code });
});

const projects = await loadProjectList();
tray.updateProjects(
	projects.map<ProjectInfo>((e) => ({
		path: e.path,
		name: e.name,
		status: processManager.getStatus(e.path),
	})),
);
