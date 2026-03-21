import { execFileAsync } from "../../lib/exec.js";

async function ghApi(args: ReadonlyArray<string>, cwd?: string): Promise<string> {
	const { stdout } = await execFileAsync("gh", args as string[], {
		maxBuffer: 50 * 1024 * 1024,
		cwd,
	});
	return stdout;
}

export async function ghApiJson<T>(args: ReadonlyArray<string>, cwd?: string): Promise<T> {
	const stdout = await ghApi(args, cwd);
	return JSON.parse(stdout) as T;
}

export async function getAuthToken(): Promise<string> {
	const stdout = await ghApi(["auth", "token"]);
	return stdout.trim();
}

export function parseRepoSlug(slug: string): { owner: string; repo: string } {
	const [owner, repo] = slug.split("/");
	if (!owner || !repo) {
		throw new Error(`invalid repo slug: ${slug}`);
	}
	return { owner, repo };
}

export async function detectRepo(): Promise<{ owner: string; repo: string }> {
	const data = await ghApiJson<{ nameWithOwner: string }>([
		"repo",
		"view",
		"--json",
		"nameWithOwner",
	]);
	return parseRepoSlug(data.nameWithOwner);
}
