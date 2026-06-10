import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { definePlotExtension } from "./packages/session/src/extension.js";
import type { PlotExtensionWork } from "./packages/session/src/extension.js";

const execFileAsync = promisify(execFile);

interface GitHubPrReviewerConfig {
	readonly includeDrafts: boolean;
}

interface PullRequestInfo {
	readonly number: number;
	readonly title: string;
	readonly isDraft: boolean;
	readonly baseRefName: string;
	readonly headRefName: string;
	readonly url: string;
	readonly headRefOid?: string;
	readonly authorLogin?: string;
}

interface PreviousReviewInfo {
	readonly state: string;
	readonly submittedAt?: string;
	readonly url?: string;
	readonly commitId?: string;
}

const defaultConfig: GitHubPrReviewerConfig = {
	includeDrafts: true,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const stringField = (
	record: Record<string, unknown>,
	field: string,
): string | undefined => {
	const value = record[field];
	return typeof value === "string" ? value : undefined;
};

const booleanField = (
	record: Record<string, unknown>,
	field: string,
): boolean | undefined => {
	const value = record[field];
	return typeof value === "boolean" ? value : undefined;
};

const numberField = (
	record: Record<string, unknown>,
	field: string,
): number | undefined => {
	const value = record[field];
	return typeof value === "number" ? value : undefined;
};

const command = async (
	cwd: string,
	file: string,
	args: readonly string[],
): Promise<string> => {
	const { stdout } = await execFileAsync(file, [...args], {
		cwd,
		encoding: "utf8",
		maxBuffer: 8 * 1024 * 1024,
		env: { ...process.env, NO_COLOR: "1" },
	});
	return stdout.trim();
};

const commandOptional = async (
	cwd: string,
	file: string,
	args: readonly string[],
): Promise<string | undefined> => {
	try {
		return await command(cwd, file, args);
	} catch {
		return undefined;
	}
};

const parseJson = (text: string | undefined): unknown | undefined => {
	if (text === undefined || text.length === 0) return undefined;
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return undefined;
	}
};

const parseConfig = (input: unknown): GitHubPrReviewerConfig => {
	if (!isRecord(input)) return defaultConfig;
	return {
		includeDrafts: booleanField(input, "includeDrafts") ?? true,
	};
};

const parsePullRequest = (value: unknown): PullRequestInfo | undefined => {
	if (!isRecord(value)) return undefined;
	const number = numberField(value, "number");
	const title = stringField(value, "title");
	const isDraft = booleanField(value, "isDraft");
	const baseRefName = stringField(value, "baseRefName");
	const headRefName = stringField(value, "headRefName");
	const url = stringField(value, "url");
	if (
		number === undefined ||
		title === undefined ||
		isDraft === undefined ||
		baseRefName === undefined ||
		headRefName === undefined ||
		url === undefined
	) {
		return undefined;
	}
	const author = value["author"];
	const authorLogin = isRecord(author)
		? stringField(author, "login")
		: undefined;
	const headRefOid = stringField(value, "headRefOid");
	return {
		number,
		title,
		isDraft,
		baseRefName,
		headRefName,
		url,
		...(headRefOid === undefined ? {} : { headRefOid }),
		...(authorLogin === undefined ? {} : { authorLogin }),
	};
};

const firstPullRequest = (value: unknown): PullRequestInfo | undefined => {
	if (!Array.isArray(value)) return undefined;
	return parsePullRequest(value[0]);
};

const parsePreviousReview = (
	value: unknown,
): PreviousReviewInfo | undefined => {
	if (!isRecord(value)) return undefined;
	const state = stringField(value, "state");
	if (state === undefined) return undefined;
	const submittedAt = stringField(value, "submitted_at");
	const url = stringField(value, "html_url");
	const commitId = stringField(value, "commit_id");
	return {
		state,
		...(submittedAt === undefined ? {} : { submittedAt }),
		...(url === undefined ? {} : { url }),
		...(commitId === undefined ? {} : { commitId }),
	};
};

const loadCurrentPullRequest = async (cwd: string, branch: string) => {
	const fields = [
		"number",
		"title",
		"isDraft",
		"baseRefName",
		"headRefName",
		"url",
		"author",
		"headRefOid",
	].join(",");
	const byView = parsePullRequest(
		parseJson(
			await commandOptional(cwd, "gh", ["pr", "view", "--json", fields]),
		),
	);
	if (byView !== undefined) return byView;
	return firstPullRequest(
		parseJson(
			await commandOptional(cwd, "gh", [
				"pr",
				"list",
				"--head",
				branch,
				"--json",
				fields,
			]),
		),
	);
};

const loadPreviousReview = async (
	cwd: string,
	repo: string,
	prNumber: number,
): Promise<PreviousReviewInfo | undefined> => {
	const currentUser = await commandOptional(cwd, "gh", [
		"api",
		"user",
		"-q",
		".login",
	]);
	if (currentUser === undefined || currentUser.length === 0) return undefined;
	const jq = `[
  .[]
  | select(.user.login == ${JSON.stringify(currentUser)} and .state != "DISMISSED")
] | sort_by(.submitted_at) | last`;
	return parsePreviousReview(
		parseJson(
			await commandOptional(cwd, "gh", [
				"api",
				`repos/${repo}/pulls/${prNumber}/reviews`,
				"--jq",
				jq,
			]),
		),
	);
};

const contextBlock = (values: {
	readonly repo: string;
	readonly branch: string;
	readonly pr?: PullRequestInfo;
	readonly previousReview?: PreviousReviewInfo;
	readonly includeDrafts: boolean;
}) => {
	const lines = [
		"## Extension-discovered target",
		`- Repository: ${values.repo}`,
		`- Current branch: ${values.branch}`,
	];
	if (values.pr === undefined) {
		return [...lines, "- Pull request: not found for the current branch"].join(
			"\n",
		);
	}
	lines.push(
		`- Pull request: #${values.pr.number} ${values.pr.title}`,
		`- URL: ${values.pr.url}`,
		`- Draft: ${String(values.pr.isDraft)}`,
		`- Base/head: ${values.pr.baseRefName}...${values.pr.headRefName}`,
	);
	if (values.pr.authorLogin !== undefined) {
		lines.push(`- Author: ${values.pr.authorLogin}`);
	}
	if (values.pr.headRefOid !== undefined) {
		lines.push(`- Head SHA: ${values.pr.headRefOid}`);
	}
	if (values.pr.isDraft && !values.includeDrafts) {
		lines.push("- Draft policy: stop after reporting that the PR is draft");
	}
	if (values.previousReview === undefined) {
		lines.push("- Previous review by current GitHub user: none found");
	} else {
		lines.push(
			`- Previous review by current GitHub user: ${values.previousReview.state}`,
		);
		if (values.previousReview.submittedAt !== undefined) {
			lines.push(
				`- Previous review submitted: ${values.previousReview.submittedAt}`,
			);
		}
		if (values.previousReview.url !== undefined) {
			lines.push(`- Previous review URL: ${values.previousReview.url}`);
		}
		if (values.previousReview.commitId !== undefined) {
			lines.push(`- Previous review commit: ${values.previousReview.commitId}`);
		}
		if (
			values.pr.headRefOid !== undefined &&
			values.previousReview.commitId === values.pr.headRefOid
		) {
			lines.push("- Previous review already covers the current head SHA");
		}
	}
	return lines.join("\n");
};

export default definePlotExtension<GitHubPrReviewerConfig>({
	id: "plot-alpha-github-pr-reviewer",
	parseConfig,
	create: ({ config, paths, work }) => ({
		discover: async (): Promise<readonly PlotExtensionWork[]> => {
			const repo =
				(await commandOptional(paths.cwd, "gh", [
					"repo",
					"view",
					"--json",
					"nameWithOwner",
					"-q",
					".nameWithOwner",
				])) ?? "unknown/unknown";
			const branch =
				(await commandOptional(paths.cwd, "git", [
					"branch",
					"--show-current",
				])) ?? "unknown";
			const pr = await loadCurrentPullRequest(paths.cwd, branch);
			const previousReview =
				pr === undefined
					? undefined
					: await loadPreviousReview(paths.cwd, repo, pr.number);
			if (
				pr?.headRefOid !== undefined &&
				previousReview?.commitId === pr.headRefOid
			) {
				return [];
			}
			const id =
				pr === undefined
					? `github:${repo}:branch:${branch}:no-pr`
					: `github:${repo}:pr:${pr.number}`;
			const title =
				pr === undefined
					? `No pull request found for ${branch}`
					: `Review ${repo} PR #${pr.number}: ${pr.title}`;
			return [
				work({
					id,
					version: pr?.headRefOid ?? branch,
					title,
					...(pr === undefined ? {} : { url: pr.url }),
					subject:
						pr === undefined
							? `github:${repo}`
							: `github:${repo}:pr:${pr.number}`,
					context: {
						githubContext: contextBlock({
							repo,
							branch,
							...(pr === undefined ? {} : { pr }),
							...(previousReview === undefined ? {} : { previousReview }),
							includeDrafts: config.includeDrafts,
						}),
					},
				}),
			];
		},
	}),
});
