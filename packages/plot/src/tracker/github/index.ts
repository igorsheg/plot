import {
	buildRunContext,
	normalizeState,
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
import { detectRepo, getAuthToken, ghApiJson, parseRepoSlug } from "./client.js";
import {
	type CommonTrackerConfig,
	deriveAllStates,
	fetchPrReviewFeedback,
	validateCommonTrackerFields,
} from "../shared.js";

function mapGhFailure(error: unknown, resourceId?: string): Error {
	const message = error instanceof Error ? error.message : String(error);
	const stderr =
		typeof error === "object" && error !== null && "stderr" in error
			? String((error as { stderr?: unknown }).stderr ?? "")
			: "";
	const details = [message, stderr].filter(Boolean).join("\n");
	const normalized = details.toLowerCase();

	if (
		normalized.includes("authentication") ||
		normalized.includes("auth") ||
		normalized.includes("401") ||
		normalized.includes("403")
	) {
		return new PluginAuthError(`github authentication failed: ${details}`);
	}

	if (normalized.includes("rate limit") || normalized.includes("429")) {
		return new PluginRateLimitError(`github rate limited: ${details}`);
	}

	if (resourceId && (normalized.includes("not found") || normalized.includes("404"))) {
		return new PluginNotFoundError(`github issue not found: ${details}`, resourceId);
	}

	return new Error(`github API failed: ${details}`);
}

interface GhIssue {
	readonly number: number;
	readonly title: string;
	readonly body: string;
	readonly state: string;
	readonly labels: ReadonlyArray<{ name: string }>;
	readonly url: string;
	readonly createdAt: string;
	readonly updatedAt: string;
}

interface GhIssueView {
	readonly number: number;
	readonly state: string;
	readonly labels: ReadonlyArray<{ name: string }>;
}

interface GhComment {
	readonly body: string;
}

interface GithubOpsConfig {
	owner: string;
	repo: string;
	allStates?: ReadonlyArray<string>;
	dispatchStates?: ReadonlyArray<string>;
	parkedStates?: ReadonlyArray<string>;
	terminalStates?: ReadonlyArray<string>;
}

function createGithubOps(config: GithubOpsConfig) {
	const allStates =
		config.allStates ??
		deriveAllStates(config.dispatchStates, config.parkedStates, config.terminalStates);

	const repoFlag = `${config.owner}/${config.repo}`;

	const withGh = async <T>(fn: () => Promise<T>, resourceId?: string): Promise<T> => {
		try {
			return await fn();
		} catch (error) {
			throw mapGhFailure(error, resourceId);
		}
	};

	const listIssues = async (ghState: "open" | "closed" | "all") => {
		return withGh(async () => {
			const issues = await ghApiJson<GhIssue[]>([
				"issue",
				"list",
				"--repo",
				repoFlag,
				"--state",
				ghState === "closed" ? "closed" : ghState === "all" ? "all" : "open",
				"--json",
				"number,title,body,state,labels,url,createdAt,updatedAt",
				"--limit",
				"500",
			]);

			return issues.map((issue) => ({
				number: issue.number,
				title: issue.title,
				body: issue.body || null,
				state: issue.state.toUpperCase(),
				labels: (issue.labels ?? []).map((l) => ({ name: l.name ?? "" })),
				url: issue.url,
				createdAt: issue.createdAt,
				updatedAt: issue.updatedAt,
			}));
		});
	};

	const viewIssue = async (issueNumber: string) => {
		return withGh(async () => {
			const issue = await ghApiJson<GhIssueView>([
				"issue",
				"view",
				issueNumber,
				"--repo",
				repoFlag,
				"--json",
				"number,state,labels",
			]);
			return {
				number: issue.number,
				state: issue.state.toUpperCase(),
				labels: (issue.labels ?? []).map((l) => ({ name: l.name ?? "" })),
			};
		}, issueNumber);
	};

	const mapState = (gh: { labels: ReadonlyArray<{ readonly name: string }>; state: string }) => {
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
		let commentsRaw: ReadonlyArray<{ body: string }> = [];
		try {
			const data = await ghApiJson<{ comments: GhComment[] }>([
				"issue",
				"view",
				issueId,
				"--repo",
				repoFlag,
				"--json",
				"comments",
			]);
			commentsRaw = data.comments ?? [];
		} catch {
			commentsRaw = [];
		}

		let workpad: string | null = null;
		const workpadComment = commentsRaw.find((c) => c.body.startsWith("## Plot Workpad"));
		if (workpadComment) workpad = workpadComment.body;

		let reviews: string | null = null;
		if (
			(config.dispatchStates ?? []).some(
				(dispatchState) => normalizeState(dispatchState) === normalizeState(state),
			)
		) {
			reviews = await fetchPrReviewFeedback(`#${issueId}`, ["--repo", repoFlag]);
		}

		return buildRunContext({ workpad, reviewFeedback: reviews });
	};

	return {
		listIssues,
		viewIssue,
		mapState,
		mapIssue,
		fetchRunContext,
	};
}

type GithubTrackerConfig = CommonTrackerConfig;

const plugin: TrackerPluginDefinition<GithubTrackerConfig> = {
	name: "github",
	validateConfig(raw: TrackerPluginConfig): GithubTrackerConfig {
		return validateCommonTrackerFields(raw);
	},
	async factory(config): Promise<PlainTrackerClient> {
		await getAuthToken();
		const { owner, repo } = config.githubRepo
			? parseRepoSlug(config.githubRepo)
			: await detectRepo();

		const ops = createGithubOps({
			owner,
			repo,
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
							return [{ id: String(gh.number), state: ops.mapState(gh) }] as IssueStateEntryLike[];
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
