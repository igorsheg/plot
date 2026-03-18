import { Effect, RcMap, Scope } from "effect";
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
import type { Octokit } from "octokit";
import {
	detectRepo,
	getAuthToken,
	makeClientMap,
	parseRepoSlug,
} from "./client.js";

const normalizeState = (s: string): string => s.trim().toLowerCase();

function mapOctokitFailure(error: unknown, resourceId?: string): Error {
	const status =
		typeof error === "object" && error !== null && "status" in error
			? (error as { status: number }).status
			: undefined;
	const message = error instanceof Error ? error.message : String(error);

	if (status === 401 || status === 403) {
		return new PluginAuthError(`github authentication failed: ${message}`);
	}

	if (status === 429) {
		return new PluginRateLimitError(`github rate limited: ${message}`);
	}

	if (status === 404 && resourceId) {
		return new PluginNotFoundError(
			`github issue not found: ${message}`,
			resourceId,
		);
	}

	return new Error(`github API failed: ${message}`);
}

interface GithubOpsConfig {
	owner: string;
	repo: string;
	allStates?: ReadonlyArray<string>;
	dispatchStates?: ReadonlyArray<string>;
	parkedStates?: ReadonlyArray<string>;
	terminalStates?: ReadonlyArray<string>;
}

function createGithubOps(
	getClient: () => Promise<Octokit>,
	config: GithubOpsConfig,
) {
	const allStates =
		config.allStates ??
		[
			...(config.dispatchStates ?? []),
			...(config.parkedStates ?? []),
			...(config.terminalStates ?? []),
		].filter((state, index, states) => states.indexOf(state) === index);

	const withClient = async <T>(
		fn: (client: Octokit) => Promise<T>,
		resourceId?: string,
	): Promise<T> => {
		const client = await getClient();
		try {
			return await fn(client);
		} catch (error) {
			throw mapOctokitFailure(error, resourceId);
		}
	};

	const listIssues = async (ghState: "open" | "closed" | "all") => {
		return withClient(async (client) => {
			const params = {
				owner: config.owner,
				repo: config.repo,
				per_page: 100,
				...(ghState !== "all" ? { state: ghState as "open" | "closed" } : { state: "all" as const }),
			};

			const issues = await client.paginate(
				client.rest.issues.listForRepo,
				params,
			);

			return issues
				.filter((issue) => !issue.pull_request)
				.slice(0, 500)
				.map((issue) => ({
					number: issue.number,
					title: issue.title,
					body: issue.body ?? null,
					state: issue.state.toUpperCase(),
					labels: (issue.labels ?? []).map((l) =>
						typeof l === "string" ? { name: l } : { name: l.name ?? "" },
					),
					url: issue.html_url,
					createdAt: issue.created_at,
					updatedAt: issue.updated_at,
				}));
		});
	};

	const viewIssue = async (issueNumber: string) => {
		return withClient(async (client) => {
			const { data } = await client.rest.issues.get({
				owner: config.owner,
				repo: config.repo,
				issue_number: Number(issueNumber),
			});
			return {
				number: data.number,
				state: data.state.toUpperCase(),
				labels: (data.labels ?? []).map((l) =>
					typeof l === "string" ? { name: l } : { name: l.name ?? "" },
				),
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
			commentsRaw = await withClient(async (client) => {
				const comments = await client.paginate(
					client.rest.issues.listComments,
					{
						owner: config.owner,
						repo: config.repo,
						issue_number: Number(issueId),
						per_page: 100,
					},
				);
				return comments.map((c) => ({ body: c.body ?? "" }));
			});
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
				const prs = await withClient(async (client) => {
					return client.paginate(client.rest.pulls.list, {
						owner: config.owner,
						repo: config.repo,
						state: "open",
						per_page: 50,
					});
				});

				const linkedPr = prs.find((pr) =>
					pr.body?.includes(`#${issueId}`),
				);
				if (linkedPr) {
					try {
						const [prReviews, prComments] = await withClient(
							async (client) => {
								const [revs, comms] = await Promise.all([
									client.rest.pulls.listReviews({
										owner: config.owner,
										repo: config.repo,
										pull_number: linkedPr.number,
									}),
									client.rest.issues.listComments({
										owner: config.owner,
										repo: config.repo,
										issue_number: linkedPr.number,
									}),
								]);
								return [revs.data, comms.data] as const;
							},
						);

						const parts: string[] = [];
						for (const r of prReviews) {
							if (r.body)
								parts.push(
									`**${r.user?.login ?? "unknown"}** (${r.state}):\n${r.body}`,
								);
						}
						for (const c of prComments) {
							if (c.body)
								parts.push(
									`**${c.user?.login ?? "unknown"}**:\n${c.body}`,
								);
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
		listIssues,
		viewIssue,
		mapState,
		mapIssue,
		fetchRunContext,
	};
}

interface GithubTrackerConfig {
	kind: string;
	githubRepo?: string;
	dispatchStates?: ReadonlyArray<string>;
	parkedStates?: ReadonlyArray<string>;
	terminalStates?: ReadonlyArray<string>;
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
		const token = await getAuthToken();
		const { owner, repo } = config.githubRepo
			? parseRepoSlug(config.githubRepo)
			: await detectRepo();

		const scope = Scope.makeUnsafe();
		const clients = await Effect.runPromise(
			Scope.provide(makeClientMap(), scope),
		);

		const getClient = async (): Promise<Octokit> => {
			return Effect.runPromise(
				RcMap.get(clients, token).pipe(Effect.scoped),
			);
		};

		const ops = createGithubOps(getClient, {
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
