import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
	buildRunContext,
	PluginAuthError,
	PluginNotFoundError,
	PluginRateLimitError,
	type IssueLike,
	type IssueStateEntryLike,
	type PlainTrackerClient,
	type TrackerPluginConfig,
	type TrackerPluginDefinition,
	type TrackerRunContextLike,
} from "@plot/sdk";

const execFileAsync = promisify(execFile);

const normalizeState = (s: string): string => s.trim().toLowerCase();

interface GithubTrackerConfig {
	kind: string;
	githubRepo?: string;
	dispatchStates?: ReadonlyArray<string>;
	parkedStates?: ReadonlyArray<string>;
	terminalStates?: ReadonlyArray<string>;
}

function mapGhFailure(error: unknown, resourceId?: string): Error {
	const message = error instanceof Error ? error.message : String(error);
	const stderr =
		typeof error === "object" && error !== null && "stderr" in error
			? String((error as { stderr?: unknown }).stderr ?? "")
			: "";
	const details = [message, stderr].filter(Boolean).join("\n");
	const normalized = details.toLowerCase();

	if (
		normalized.includes("authentication failed") ||
		normalized.includes("not logged into any github hosts") ||
		normalized.includes("gh auth login")
	) {
		return new PluginAuthError(`gh authentication failed: ${details}`);
	}

	if (
		normalized.includes("rate limit") ||
		normalized.includes("api rate limit exceeded")
	) {
		return new PluginRateLimitError(`gh rate limited: ${details}`);
	}

	if (
		resourceId &&
		(normalized.includes("could not resolve to an issue") ||
			normalized.includes("not found") ||
			normalized.includes("no issue found"))
	) {
		return new PluginNotFoundError(
			`github issue not found: ${details}`,
			resourceId,
		);
	}

	return new Error(`gh command failed: ${details}`);
}

function createGithubOps(config: {
	repo?: string;
	allStates?: ReadonlyArray<string>;
	dispatchStates?: ReadonlyArray<string>;
	parkedStates?: ReadonlyArray<string>;
	terminalStates?: ReadonlyArray<string>;
}) {
	const allStates =
		config.allStates ??
		[
			...(config.dispatchStates ?? []),
			...(config.parkedStates ?? []),
			...(config.terminalStates ?? []),
		].filter((state, index, states) => states.indexOf(state) === index);
	const repoArgs = config.repo ? ["--repo", config.repo] : [];
	const ghFields = "number,title,body,state,labels,url,createdAt,updatedAt";

	const runGh = async (
		args: ReadonlyArray<string>,
		options?: { resourceId?: string },
	): Promise<{ stdout: string; stderr: string }> => {
		try {
			return await execFileAsync("gh", args as string[], {
				maxBuffer: 50 * 1024 * 1024,
			});
		} catch (error) {
			throw mapGhFailure(error, options?.resourceId);
		}
	};

	const listIssues = async (ghState: "open" | "closed" | "all") => {
		const result = await runGh([
			"issue",
			"list",
			...repoArgs,
			"--state",
			ghState,
			"--json",
			ghFields,
			"--limit",
			"500",
		]);
		return JSON.parse(result.stdout) as ReadonlyArray<{
			number: number;
			title: string;
			body: string | null;
			state: string;
			labels: ReadonlyArray<{ name: string }>;
			url: string;
			createdAt: string;
			updatedAt: string;
		}>;
	};

	const viewIssue = async (issueNumber: string) => {
		const result = await runGh(
			[
				"issue",
				"view",
				issueNumber,
				...repoArgs,
				"--json",
				"number,state,labels",
			],
			{ resourceId: issueNumber },
		);
		return JSON.parse(result.stdout) as {
			number: number;
			state: string;
			labels: ReadonlyArray<{ name: string }>;
		};
	};

	const mapState = (gh: {
		labels: ReadonlyArray<{ readonly name: string }>;
		state: string;
	}) => {
		const labelNames = gh.labels.map((l) => normalizeState(l.name));
		for (const s of allStates) {
			if (labelNames.includes(normalizeState(s))) return s;
		}
		return gh.state === "OPEN" ? "" : "Closed";
	};

	const mapIssue = (gh: {
		number: number;
		title: string;
		body: string | null;
		state: string;
		labels: ReadonlyArray<{ name: string }>;
		url: string;
		createdAt: string;
		updatedAt: string;
	}): IssueLike => ({
		id: String(gh.number),
		identifier: `#${gh.number}`,
		title: gh.title,
		description: gh.body,
		state: mapState(gh),
		url: gh.url,
		labels: gh.labels.map((l) => l.name.toLowerCase()),
		createdAt: gh.createdAt || null,
		updatedAt: gh.updatedAt || null,
	});

	const fetchRunContext = async (
		issueId: string,
		state: string,
	): Promise<TrackerRunContextLike | null> => {
		if (!config.repo) return null;

		let commentsRaw: ReadonlyArray<{ body: string }> = [];
		try {
			const commentsResult = await runGh([
				"api",
				`repos/${config.repo}/issues/${issueId}/comments`,
			]);
			commentsRaw = JSON.parse(commentsResult.stdout) as ReadonlyArray<{
				body: string;
			}>;
		} catch {
			commentsRaw = [];
		}

		let workpad: string | null = null;
		const workpadComment = commentsRaw.find((c) =>
			c.body.startsWith("## Plot Workpad"),
		);
		if (workpadComment) workpad = workpadComment.body;

		let reviews: string | null = null;
		if (
			(config.dispatchStates ?? []).some(
				(dispatchState) =>
					normalizeState(dispatchState) === normalizeState(state),
			)
		) {
			try {
				const prSearchResult = await runGh([
					"pr",
					"list",
					...(config.repo ? ["--repo", config.repo] : []),
					"--state",
					"open",
					"--json",
					"number,headRefName,body",
					"--limit",
					"50",
				]);

				const prs = JSON.parse(prSearchResult.stdout) as ReadonlyArray<{
					number: number;
					body: string;
				}>;
				const linkedPr = prs.find((pr) => pr.body?.includes(`#${issueId}`));
				if (linkedPr) {
					try {
						const reviewResult = await runGh([
							"pr",
							"view",
							String(linkedPr.number),
							...(config.repo ? ["--repo", config.repo] : []),
							"--json",
							"reviews,comments",
						]);

						const prData = JSON.parse(reviewResult.stdout) as {
							reviews?: ReadonlyArray<{
								body: string;
								state: string;
								author: { login: string };
							}>;
							comments?: ReadonlyArray<{
								body: string;
								author: { login: string };
							}>;
						};
						const parts: string[] = [];
						if (prData.reviews?.length) {
							for (const r of prData.reviews) {
								if (r.body)
									parts.push(`**${r.author.login}** (${r.state}):\n${r.body}`);
							}
						}
						if (prData.comments?.length) {
							for (const c of prData.comments) {
								if (c.body) parts.push(`**${c.author.login}**:\n${c.body}`);
							}
						}
						reviews = parts.length > 0 ? parts.join("\n\n---\n\n") : null;
					} catch {
						// ignore PR review fetch failures
					}
				}
			} catch {
				// ignore PR search failures
			}
		}

		return buildRunContext({ workpad, reviewFeedback: reviews });
	};

	return {
		runGh,
		listIssues,
		viewIssue,
		mapState,
		mapIssue,
		fetchRunContext,
	};
}

const plugin: TrackerPluginDefinition<GithubTrackerConfig> = {
	name: "github",
	validateConfig(raw: TrackerPluginConfig): GithubTrackerConfig {
		return {
			kind: String(raw.kind),
			githubRepo:
				typeof raw["githubRepo"] === "string" ? raw["githubRepo"] : undefined,
			dispatchStates: Array.isArray(raw["dispatchStates"])
				? raw["dispatchStates"]
				: undefined,
			parkedStates: Array.isArray(raw["parkedStates"])
				? raw["parkedStates"]
				: undefined,
			terminalStates: Array.isArray(raw["terminalStates"])
				? raw["terminalStates"]
				: undefined,
		};
	},
	async factory(config): Promise<PlainTrackerClient> {
		const ops = createGithubOps({
			repo: config.githubRepo,
			dispatchStates: config.dispatchStates,
			parkedStates: config.parkedStates,
			terminalStates: config.terminalStates,
		});

		return {
			async fetchCandidateIssues(dispatchStates) {
				const ghIssues = await ops.listIssues("open");
				const issues = ghIssues.map(ops.mapIssue);
				const normalized = new Set(dispatchStates.map(normalizeState));
				return issues.filter((i) => normalized.has(normalizeState(i.state)));
			},
			async fetchIssuesByStates(states) {
				const ghIssues = await ops.listIssues("all");
				const issues = ghIssues.map(ops.mapIssue);
				const normalized = new Set(states.map(normalizeState));
				return issues.filter((i) => normalized.has(normalizeState(i.state)));
			},
			async fetchIssueStatesByIds(ids) {
				const results = await Promise.all(
					ids.map(async (id) => {
						try {
							const gh = await ops.viewIssue(id);
							return [
								{ id: String(gh.number), state: ops.mapState(gh) },
							] as IssueStateEntryLike[];
						} catch (e) {
							if (e instanceof PluginNotFoundError) return [];
							throw e;
						}
					}),
				);
				return results.flat();
			},
			fetchRunContext: (issueId, state) => ops.fetchRunContext(issueId, state),
		};
	},
};

export default plugin;
