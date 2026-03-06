import { DateTime, Effect, Layer } from "effect";
import { Issue, IssueStateEntry, TrackerError } from "@plot/shared";
import { TrackerClient } from "./tracker-client.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const normalizeState = (s: string): string => s.trim().toLowerCase();

interface GhIssue {
	number: number;
	title: string;
	body: string | null;
	state: string;
	labels: Array<{ name: string }>;
	url: string;
	createdAt: string;
	updatedAt: string;
}

export const makeGithubTracker = (config: {
	repo?: string;
	allStates?: ReadonlyArray<string>;
}) => {
	const allStates = config.allStates ?? [
		"Todo",
		"In Progress",
		"Human Review",
		"Rework",
		"Merging",
		"Done",
		"Closed",
		"Cancelled",
	];
	const repoArgs = config.repo ? ["--repo", config.repo] : [];
	const ghFields = "number,title,body,state,labels,url,createdAt,updatedAt";

	const runGh = (args: ReadonlyArray<string>) =>
		Effect.tryPromise({
			try: () =>
				execFileAsync("gh", args as string[], {
					maxBuffer: 50 * 1024 * 1024,
				}),
			catch: (e) =>
				new TrackerError({
					code: "github_cli",
					message: `gh command failed: ${e instanceof Error ? e.message : String(e)}`,
				}),
		});

	const listIssues = (ghState: "open" | "closed" | "all") =>
		Effect.gen(function* () {
			const result = yield* runGh([
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
			try {
				return JSON.parse(result.stdout) as Array<GhIssue>;
			} catch {
				return yield* new TrackerError({
					code: "github_parse",
					message: "Failed to parse gh output",
				});
			}
		});

	const viewIssue = (issueNumber: string) =>
		Effect.gen(function* () {
			const result = yield* runGh([
				"issue",
				"view",
				issueNumber,
				...repoArgs,
				"--json",
				"number,state,labels",
			]);
			try {
				return JSON.parse(result.stdout) as GhIssue;
			} catch {
				return yield* new TrackerError({
					code: "github_parse",
					message: "Failed to parse gh output",
				});
			}
		});

	const mapState = (gh: GhIssue): string => {
		const labelNames = gh.labels.map((l) => normalizeState(l.name));
		for (const s of allStates) {
			if (labelNames.includes(normalizeState(s))) return s;
		}
		return gh.state === "OPEN" ? (allStates[0] ?? "Todo") : "Done";
	};

	const mapIssue = (gh: GhIssue): Issue =>
		new Issue({
			id: String(gh.number),
			identifier: `#${gh.number}`,
			title: gh.title,
			description: gh.body,
			priority: null,
			state: mapState(gh),
			branchName: null,
			url: gh.url,
			labels: gh.labels.map((l) => l.name.toLowerCase()),
			blockedBy: [],
			createdAt: gh.createdAt
				? DateTime.unsafeFromDate(new Date(gh.createdAt))
				: null,
			updatedAt: gh.updatedAt
				? DateTime.unsafeFromDate(new Date(gh.updatedAt))
				: null,
		});

	return Layer.succeed(
		TrackerClient,
		TrackerClient.of({
			fetchCandidateIssues: (activeStates) =>
				Effect.gen(function* () {
					const ghIssues = yield* listIssues("open");
					const issues = ghIssues.map(mapIssue);
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
					const ghIssues = yield* listIssues("all");
					const issues = ghIssues.map(mapIssue);
					const normalized = new Set(states.map(normalizeState));
					return issues.filter((i) =>
						normalized.has(normalizeState(i.state)),
					);
				}),

			fetchIssueStatesByIds: (ids) =>
				Effect.gen(function* () {
					const effects = ids.map((id) =>
						Effect.map(
							viewIssue(id),
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
