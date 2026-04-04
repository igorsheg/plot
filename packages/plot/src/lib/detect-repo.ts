import { execFileAsync } from "./exec.js";
import type { WorkflowOverrides } from "../config.js";

export async function detectGithubRepo(cwd: string): Promise<string> {
	const { stdout } = await execFileAsync("gh", [
		"repo",
		"view",
		"--json",
		"nameWithOwner",
	], {
		maxBuffer: 50 * 1024 * 1024,
		cwd,
	});
	const data = JSON.parse(stdout) as { nameWithOwner: string };
	const [owner, repo] = data.nameWithOwner.split("/");
	if (!owner || !repo) {
		throw new Error(`invalid repo slug: ${data.nameWithOwner}`);
	}
	return `${owner}/${repo}`;
}

export async function resolveOverrides(
	overrides: WorkflowOverrides,
	projectDir: string,
): Promise<WorkflowOverrides> {
	if (overrides.githubRepo) return overrides;
	try {
		const githubRepo = await detectGithubRepo(projectDir);
		return { ...overrides, githubRepo };
	} catch {
		return overrides;
	}
}
