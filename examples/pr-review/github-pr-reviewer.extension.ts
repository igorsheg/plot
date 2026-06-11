import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { definePlotExtension } from "../../packages/session/src/extension.js";
import type { PlotExtensionWork } from "../../packages/session/src/extension.js";

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

interface PreviousReviewCommentInfo {
	readonly path?: string;
	readonly line?: number;
	readonly body?: string;
	readonly url?: string;
}

interface PreviousReviewInfo {
	readonly id?: number;
	readonly state: string;
	readonly submittedAt?: string;
	readonly url?: string;
	readonly commitId?: string;
	readonly body?: string;
	readonly comments: readonly PreviousReviewCommentInfo[];
}

interface PreviousPlotPostInfo {
	readonly kind: "issue_comment" | "pull_request_review";
	readonly createdAt?: string;
	readonly url?: string;
	readonly marker: string;
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

const indentBlock = (value: string) =>
	value
		.split("\n")
		.map((line) => `  ${line}`)
		.join("\n");

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

const parsePreviousReviewComment = (
	value: unknown,
): PreviousReviewCommentInfo | undefined => {
	if (!isRecord(value)) return undefined;
	const path = stringField(value, "path");
	const line =
		numberField(value, "line") ?? numberField(value, "original_line");
	const body = stringField(value, "body");
	const url = stringField(value, "html_url");
	return {
		...(path === undefined ? {} : { path }),
		...(line === undefined ? {} : { line }),
		...(body === undefined ? {} : { body }),
		...(url === undefined ? {} : { url }),
	};
};

const parsePreviousReview = (
	value: unknown,
	comments: readonly PreviousReviewCommentInfo[],
): PreviousReviewInfo | undefined => {
	if (!isRecord(value)) return undefined;
	const state = stringField(value, "state");
	if (state === undefined) return undefined;
	const id = numberField(value, "id");
	const submittedAt = stringField(value, "submitted_at");
	const url = stringField(value, "html_url");
	const commitId = stringField(value, "commit_id");
	const body = stringField(value, "body");
	return {
		...(id === undefined ? {} : { id }),
		state,
		...(submittedAt === undefined ? {} : { submittedAt }),
		...(url === undefined ? {} : { url }),
		...(commitId === undefined ? {} : { commitId }),
		...(body === undefined ? {} : { body }),
		comments,
	};
};

const parsePreviousPlotPost = (
	value: unknown,
	marker: string,
	kind: PreviousPlotPostInfo["kind"],
): PreviousPlotPostInfo | undefined => {
	if (!isRecord(value)) return undefined;
	const createdAt =
		stringField(value, "created_at") ?? stringField(value, "submitted_at");
	const url = stringField(value, "html_url");
	return {
		kind,
		marker,
		...(createdAt === undefined ? {} : { createdAt }),
		...(url === undefined ? {} : { url }),
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

const loadCurrentUser = (cwd: string) =>
	commandOptional(cwd, "gh", ["api", "user", "-q", ".login"]);

const loadPreviousReview = async (
	cwd: string,
	repo: string,
	prNumber: number,
): Promise<PreviousReviewInfo | undefined> => {
	const currentUser = await loadCurrentUser(cwd);
	if (currentUser === undefined || currentUser.length === 0) return undefined;
	const jq = `[
  .[]
  | select(.user.login == ${JSON.stringify(currentUser)} and .state != "DISMISSED")
] | sort_by(.submitted_at) | last`;
	const reviewJson = parseJson(
		await commandOptional(cwd, "gh", [
			"api",
			`repos/${repo}/pulls/${prNumber}/reviews`,
			"--jq",
			jq,
		]),
	);
	const reviewId = isRecord(reviewJson)
		? numberField(reviewJson, "id")
		: undefined;
	const commentsJson =
		reviewId === undefined
			? undefined
			: parseJson(
					await commandOptional(cwd, "gh", [
						"api",
						`repos/${repo}/pulls/${prNumber}/reviews/${reviewId}/comments`,
					]),
				);
	const comments = Array.isArray(commentsJson)
		? commentsJson
				.map(parsePreviousReviewComment)
				.filter(
					(comment): comment is PreviousReviewCommentInfo =>
						comment !== undefined,
				)
		: [];
	return parsePreviousReview(reviewJson, comments);
};

const plotCommentMarker = (headSha: string) =>
	`<!-- plot-pr-review:${headSha} -->`;

const loadPreviousPlotIssueComment = async (
	cwd: string,
	repo: string,
	prNumber: number,
	headSha: string,
): Promise<PreviousPlotPostInfo | undefined> => {
	const currentUser = await loadCurrentUser(cwd);
	if (currentUser === undefined || currentUser.length === 0) return undefined;
	const marker = plotCommentMarker(headSha);
	const jq = `[
  .[]
  | select(.user.login == ${JSON.stringify(currentUser)} and ((.body // "") | contains(${JSON.stringify(marker)})))
] | sort_by(.created_at) | last`;
	return parsePreviousPlotPost(
		parseJson(
			await commandOptional(cwd, "gh", [
				"api",
				`repos/${repo}/issues/${prNumber}/comments`,
				"--jq",
				jq,
			]),
		),
		marker,
		"issue_comment",
	);
};

const loadPreviousPlotReview = async (
	cwd: string,
	repo: string,
	prNumber: number,
	headSha: string,
): Promise<PreviousPlotPostInfo | undefined> => {
	const currentUser = await loadCurrentUser(cwd);
	if (currentUser === undefined || currentUser.length === 0) return undefined;
	const marker = plotCommentMarker(headSha);
	const jq = `[
  .[]
  | select(.user.login == ${JSON.stringify(currentUser)} and .state != "DISMISSED" and ((.body // "") | contains(${JSON.stringify(marker)})))
] | sort_by(.submitted_at) | last`;
	return parsePreviousPlotPost(
		parseJson(
			await commandOptional(cwd, "gh", [
				"api",
				`repos/${repo}/pulls/${prNumber}/reviews`,
				"--jq",
				jq,
			]),
		),
		marker,
		"pull_request_review",
	);
};

const loadPreviousPlotPost = async (
	cwd: string,
	repo: string,
	prNumber: number,
	headSha: string,
) =>
	(await loadPreviousPlotReview(cwd, repo, prNumber, headSha)) ??
	(await loadPreviousPlotIssueComment(cwd, repo, prNumber, headSha));

const contextBlock = (values: {
	readonly repo: string;
	readonly branch: string;
	readonly pr?: PullRequestInfo;
	readonly previousReview?: PreviousReviewInfo;
	readonly previousPlotPost?: PreviousPlotPostInfo;
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
		lines.push(
			`- Head SHA: ${values.pr.headRefOid}`,
			`- Required durable comment marker: ${plotCommentMarker(values.pr.headRefOid)}`,
		);
	}
	if (values.pr.isDraft && !values.includeDrafts) {
		lines.push("- Draft policy: stop after reporting that the PR is draft");
	}
	if (values.previousPlotPost === undefined) {
		lines.push("- Previous Plot review post for current head: none found");
	} else {
		lines.push(
			`- Previous Plot review post already covers current head (${values.previousPlotPost.kind})`,
		);
		if (values.previousPlotPost.createdAt !== undefined) {
			lines.push(
				`- Previous Plot review post created: ${values.previousPlotPost.createdAt}`,
			);
		}
		if (values.previousPlotPost.url !== undefined) {
			lines.push(
				`- Previous Plot review post URL: ${values.previousPlotPost.url}`,
			);
		}
	}
	if (values.previousReview === undefined) {
		lines.push("- Previous GitHub review by current user: none found");
	} else {
		lines.push(
			`- Previous GitHub review by current user: ${values.previousReview.state}`,
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
		if (values.previousReview.body !== undefined) {
			lines.push(
				"- Previous review body excerpt:",
				indentBlock(values.previousReview.body.slice(0, 2000)),
			);
		}
		if (values.previousReview.comments.length > 0) {
			lines.push("- Previous inline review comments:");
			for (const comment of values.previousReview.comments.slice(0, 12)) {
				const location = `${comment.path ?? "unknown"}${comment.line === undefined ? "" : `:${comment.line}`}`;
				lines.push(
					`  - ${location}: ${(comment.body ?? "").replace(/\s+/g, " ").slice(0, 500)}`,
				);
			}
		}
		if (
			values.pr.headRefOid !== undefined &&
			values.previousReview.commitId === values.pr.headRefOid
		) {
			lines.push("- Previous review already covers the current head SHA");
		} else if (values.pr.headRefOid !== undefined) {
			lines.push(
				"- Review mode: incremental re-review. Check whether previous inline findings are resolved, then review new commits/changes.",
			);
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
			const previousPlotPost =
				pr?.headRefOid === undefined
					? undefined
					: await loadPreviousPlotPost(
							paths.cwd,
							repo,
							pr.number,
							pr.headRefOid,
						);
			if (previousPlotPost !== undefined) {
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
					display:
						pr === undefined
							? {
									kind: "github-pr-review",
									primary: branch,
									title: `No pull request found`,
									subtitle: repo,
									labels: ["no-pr"],
								}
							: {
									kind: "github-pr-review",
									primary: `#${pr.number}`,
									title: pr.title,
									subtitle: `${repo} · ${pr.baseRefName}...${pr.headRefName}`,
									url: pr.url,
									...(pr.headRefOid === undefined
										? {}
										: { version: pr.headRefOid.slice(0, 7) }),
									labels: [
										previousReview === undefined ? "fresh" : "incremental",
									],
								},
					context: {
						githubContext: contextBlock({
							repo,
							branch,
							...(pr === undefined ? {} : { pr }),
							...(previousReview === undefined ? {} : { previousReview }),
							...(previousPlotPost === undefined ? {} : { previousPlotPost }),
							includeDrafts: config.includeDrafts,
						}),
					},
				}),
			];
		},
	}),
});
