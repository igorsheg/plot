import { BrowserWindow, BrowserView } from "electrobun/bun";
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
				const entry = await addProject(folderPath);
				return {
					path: entry.path,
					name: entry.name,
					status: processManager.getStatus(entry.path),
				} satisfies ProjectInfo;
			},

			async removeProject({ path: folderPath }) {
				await removeProject(folderPath);
				return true;
			},

			async readWorkflow({ projectPath }) {
				return readWorkflowFile(projectPath);
			},

			async saveWorkflow({ projectPath, workflow }) {
				await saveWorkflowFile(projectPath, workflow);
				return true;
			},

			async startAgent({ projectPath }) {
				const pid = await processManager.start(
					projectPath,
					projectPath + "/WORKFLOW.md",
				);
				return { pid };
			},

			async stopAgent({ projectPath }) {
				await processManager.stop(projectPath);
				return true;
			},

			async getAgentStatus({ projectPath }) {
				return processManager.getStatus(projectPath);
			},

			async pickFolder() {
				return null;
			},
		},
		messages: {},
	},
});

const win = new BrowserWindow({
	title: "Plot",
	url: "views://main/index.html",
	rpc,
	frame: {
		width: 480,
		height: 720,
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
