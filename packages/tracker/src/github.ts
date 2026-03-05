import { DateTime, Effect, Layer } from "effect";
import { Issue, IssueStateEntry, TrackerError } from "@plot/shared";
import { TrackerClient } from "./tracker-client.js";

interface GitHubIssue {
	number: number;
	title: string;
	body: string | null;
	state: string;
	labels: Array<{ name: string }>;
	html_url: string;
	created_at: string;
	updated_at: string;
}

const normalizeState = (s: string): string => s.trim().toLowerCase();

export const makeGithubTracker = (config: {
	repo: string;
	token: string;
	allStates?: ReadonlyArray<string>;
}) => {
	const allStates = config.allStates ?? [
		"Todo",
		"In Progress",
		"Done",
		"Closed",
		"Cancelled",
	];
	const baseUrl = "https://api.github.com";
	const headers: Record<string, string> = {
		Accept: "application/vnd.github+json",
		"X-GitHub-Api-Version": "2022-11-28",
	};
	if (config.token) {
		headers["Authorization"] = `Bearer ${config.token}`;
	}

	const apiFetch = (path: string) =>
		Effect.tryPromise({
			try: () =>
				fetch(`${baseUrl}${path}`, { headers }).then(async (res) => {
					if (res.status === 401 || res.status === 403) {
						throw Object.assign(new Error(`GitHub auth error: ${res.status}`), {
							code: "github_auth",
						});
					}
					if (!res.ok) {
						throw Object.assign(
							new Error(`GitHub API error: ${res.status} ${res.statusText}`),
							{ code: "github_fetch" },
						);
					}
					return {
						body: (await res.json()) as Array<GitHubIssue>,
						headers: res.headers,
					};
				}),
			catch: (e) =>
				new TrackerError({
					code: (e as { code?: string }).code ?? "github_fetch",
					message: String(e),
				}),
		});

	const apiFetchSingle = (path: string) =>
		Effect.tryPromise({
			try: () =>
				fetch(`${baseUrl}${path}`, { headers }).then(async (res) => {
					if (res.status === 401 || res.status === 403) {
						throw Object.assign(new Error(`GitHub auth error: ${res.status}`), {
							code: "github_auth",
						});
					}
					if (!res.ok) {
						throw Object.assign(
							new Error(`GitHub API error: ${res.status} ${res.statusText}`),
							{ code: "github_fetch" },
						);
					}
					return (await res.json()) as GitHubIssue;
				}),
			catch: (e) =>
				new TrackerError({
					code: (e as { code?: string }).code ?? "github_fetch",
					message: String(e),
				}),
		});

	const fetchPaginated = (ghState: "open" | "all") =>
		Effect.gen(function* () {
			const allIssues: Array<GitHubIssue> = [];
			for (let page = 1; page <= 10; page++) {
				const { body, headers: resHeaders } = yield* apiFetch(
					`/repos/${config.repo}/issues?state=${ghState}&per_page=100&page=${page}`,
				);
				allIssues.push(...body);
				const link = resHeaders.get("link") ?? "";
				if (!link.includes('rel="next"') || body.length < 100) break;
			}
			return allIssues;
		});

	const mapState = (gh: GitHubIssue): string => {
		const labelNames = gh.labels.map((l) => normalizeState(l.name));
		for (const s of allStates) {
			if (labelNames.includes(normalizeState(s))) return s;
		}
		return gh.state === "open" ? (allStates[0] ?? "Todo") : "Done";
	};

	const mapIssue = (gh: GitHubIssue): Issue =>
		new Issue({
			id: String(gh.number),
			identifier: `#${gh.number}`,
			title: gh.title,
			description: gh.body,
			priority: null,
			state: mapState(gh),
			branchName: null,
			url: gh.html_url,
			labels: gh.labels.map((l) => l.name.toLowerCase()),
			blockedBy: [],
			createdAt: DateTime.unsafeFromDate(new Date(gh.created_at)),
			updatedAt: DateTime.unsafeFromDate(new Date(gh.updated_at)),
		});

	return Layer.succeed(
		TrackerClient,
		TrackerClient.of({
			fetchCandidateIssues: (activeStates) =>
				Effect.gen(function* () {
					const ghIssues = yield* fetchPaginated("open");
					const issues = ghIssues
						.filter((gh) => !("pull_request" in gh))
						.map(mapIssue);
					const normalized = new Set(activeStates.map(normalizeState));
					const candidates = issues.filter((i) =>
						normalized.has(normalizeState(i.state)),
					);
					yield* Effect.logDebug("tracker_fetch").pipe(
						Effect.annotateLogs({
							component: "tracker",
							operation: "fetch_candidates",
							total: String(issues.length),
							candidates: String(candidates.length),
							active_states: activeStates.join(","),
						}),
					);
					return candidates;
				}),

			fetchIssuesByStates: (states) =>
				Effect.gen(function* () {
					const ghIssues = yield* fetchPaginated("all");
					const issues = ghIssues
						.filter((gh) => !("pull_request" in gh))
						.map(mapIssue);
					const normalized = new Set(states.map(normalizeState));
					return issues.filter((i) => normalized.has(normalizeState(i.state)));
				}),

			fetchIssueStatesByIds: (ids) =>
				Effect.gen(function* () {
					const effects = ids.map((id) =>
						Effect.map(
							apiFetchSingle(`/repos/${config.repo}/issues/${id}`),
							(gh) =>
								new IssueStateEntry({
									id: String(gh.number),
									state: mapState(gh),
								}),
						),
					);
					return yield* Effect.all(effects, { concurrency: 5 });
				}),
		}),
	);
};
