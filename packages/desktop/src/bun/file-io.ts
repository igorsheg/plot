import path from "node:path";
import os from "node:os";
import type { ParsedWorkflow } from "../shared/types";
import { parseWorkflow, serializeWorkflow } from "../shared/workflow";

const CONFIG_DIR = path.join(os.homedir(), ".plot-desktop");
const PROJECTS_FILE = path.join(CONFIG_DIR, "projects.json");

type ProjectEntry = { path: string; name: string };
type ProjectListFile = { projects: ProjectEntry[] };

async function ensureConfigDir(): Promise<void> {
	const file = Bun.file(CONFIG_DIR);
	if (!(await file.exists())) {
		await Bun.write(Bun.file(path.join(CONFIG_DIR, ".keep")), "");
	}
}

export async function loadProjectList(): Promise<ProjectEntry[]> {
	const file = Bun.file(PROJECTS_FILE);
	if (!(await file.exists())) {
		return [];
	}
	const data: ProjectListFile = await file.json();
	return data.projects ?? [];
}

export async function saveProjectList(
	projects: ProjectEntry[],
): Promise<void> {
	await ensureConfigDir();
	const data: ProjectListFile = { projects };
	await Bun.write(PROJECTS_FILE, JSON.stringify(data, null, 2));
}

export async function addProject(
	folderPath: string,
): Promise<ProjectEntry> {
	const dirFile = Bun.file(folderPath);
	if (!(await dirFile.exists())) {
		throw new Error(`Folder does not exist: ${folderPath}`);
	}

	const gitDir = Bun.file(path.join(folderPath, ".git"));
	if (!(await gitDir.exists())) {
		throw new Error(`Not a git repository: ${folderPath}`);
	}

	const entry: ProjectEntry = {
		path: folderPath,
		name: path.basename(folderPath),
	};

	const projects = await loadProjectList();
	const existing = projects.find((p) => p.path === folderPath);
	if (existing) {
		return existing;
	}

	projects.push(entry);
	await saveProjectList(projects);
	return entry;
}

export async function removeProject(folderPath: string): Promise<void> {
	const projects = await loadProjectList();
	const filtered = projects.filter((p) => p.path !== folderPath);
	await saveProjectList(filtered);
}

export async function readWorkflowFile(
	projectPath: string,
): Promise<ParsedWorkflow | null> {
	const filePath = path.join(projectPath, "WORKFLOW.md");
	const file = Bun.file(filePath);
	if (!(await file.exists())) {
		return null;
	}
	const content = await file.text();
	return parseWorkflow(content) as ParsedWorkflow;
}

export async function saveWorkflowFile(
	projectPath: string,
	workflow: ParsedWorkflow,
): Promise<void> {
	const filePath = path.join(projectPath, "WORKFLOW.md");
	const content = serializeWorkflow(workflow.frontmatter, workflow.body);
	await Bun.write(filePath, content);
}
