import {
	defineTracker,
	normalizeState,
	PluginNotFoundError,
	type TrackerIssue,
	type TrackerIssueState,
	type TrackerRunContextRaw,
	type TrackerPluginConfig,
} from "@plot/sdk";
import {
	type CommonTrackerConfig,
	deriveAllStates,
	fetchPrReviewFeedback,
	validateCommonTrackerFields,
	mapCliFailure,
} from "../shared.js";
import { execFileAsync } from "../../lib/exec.js";

async function ghApi(
	args: ReadonlyArray<string>,
	cwd?: string,
): Promise<string> {
	const { stdout } = await execFileAsync("gh", args as string[], {
		maxBuffer: 50 * 1024 * 1024,
		cwd,
	});
	return stdout;
}

async function ghApiJson<T>(
	args: ReadonlyArray<string>,
	cwd?: string,
): Promise<T> {
	const stdout = await ghApi(args, cwd);
	return JSON.parse(stdout) as T;
}

async function getAuthToken(): Promise<string> {
	const stdout = await ghApi(["auth", "token"]);
	return stdout.trim();
}

function parseRepoSlug(slug: string): { owner: string; repo: string } {
	const [owner, repo] = slug.split("/");
	if (!owner || !repo) {
		throw new Error(`invalid repo slug: ${slug}`);
	}
	return { owner, repo };
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
		deriveAllStates(
			config.dispatchStates,
			config.parkedStates,
			config.terminalStates,
		);

	const repoFlag = `${config.owner}/${config.repo}`;

	const withGh = async <T>(
		fn: () => Promise<T>,
		resourceId?: string,
	): Promise<T> => {
		try {
			return await fn();
		} catch (error) {
			throw mapCliFailure("github", error, resourceId);
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
	}): TrackerIssue => ({
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
	): Promise<TrackerRunContextRaw | null> => {
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
			reviews = await fetchPrReviewFeedback(`#${issueId}`, [
				"--repo",
				repoFlag,
			]);
		}

		return { workpad, reviewFeedback: reviews };
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

type GithubSetup = {
	owner: string;
	repo: string;
	repoArgs: string[];
	ops: ReturnType<typeof createGithubOps>;
};

export default defineTracker<GithubTrackerConfig, GithubSetup>({
	name: "github",
	config(raw: TrackerPluginConfig): GithubTrackerConfig {
		return validateCommonTrackerFields(raw);
	},
	async setup(ctx) {
		await getAuthToken();
		if (!ctx.config.githubRepo) {
			throw new Error("githubRepo is required — it should be resolved at startup from the project directory or set explicitly via github_repo in WORKFLOW.md");
		}
		const { owner, repo } = parseRepoSlug(ctx.config.githubRepo);
		const repoArgs = ["--repo", `${owner}/${repo}`];
		const ops = createGithubOps({
			owner,
			repo,
			dispatchStates: ctx.config.dispatchStates,
			parkedStates: ctx.config.parkedStates,
			terminalStates: ctx.config.terminalStates,
		});
		return { owner, repo, repoArgs, ops };
	},
	async fetchCandidateIssues(ctx, dispatchStates) {
		const ghIssues = await ctx.ops.listIssues("open");
		const issues = ghIssues.map(ctx.ops.mapIssue);
		const normalized = new Set(dispatchStates.map(normalizeState));
		return issues.filter((i) => normalized.has(normalizeState(i.state)));
	},
	async fetchIssuesByStates(ctx, states) {
		const ghIssues = await ctx.ops.listIssues("all");
		const issues = ghIssues.map(ctx.ops.mapIssue);
		const normalized = new Set(states.map(normalizeState));
		return issues.filter((i) => normalized.has(normalizeState(i.state)));
	},
	async fetchIssueStatesByIds(ctx, ids) {
		const results = await Promise.all(
			ids.map(async (id) => {
				try {
					const gh = await ctx.ops.viewIssue(id);
					return [
						{ id: String(gh.number), state: ctx.ops.mapState(gh) },
					] as TrackerIssueState[];
				} catch (e) {
					if (e instanceof PluginNotFoundError) return [];
					throw e;
				}
			}),
		);
		return results.flat();
	},
	async fetchRunContext(ctx, issueId, state) {
		return ctx.ops.fetchRunContext(issueId, state);
	},
});
