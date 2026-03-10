import { DateTime, Effect, Layer, Schema } from "effect";
import { Issue, IssueStateEntry, TrackerError, TrackerClient } from "@plot/sdk";
import type { TrackerPlugin, TrackerPluginConfig } from "@plot/sdk";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildTrackerRunContext } from "../core/workpad-context.js";

const execFileAsync = promisify(execFile);

const normalizeState = (s: string): string => s.trim().toLowerCase();

const GhLabel = Schema.Struct({
	name: Schema.String,
});

const GhIssue = Schema.Struct({
	number: Schema.Number,
	title: Schema.String,
	body: Schema.NullOr(Schema.String),
	state: Schema.String,
	labels: Schema.Array(GhLabel),
	url: Schema.String,
	createdAt: Schema.String,
	updatedAt: Schema.String,
});

const GhIssueList = Schema.Array(GhIssue);

const GhIssueView = Schema.Struct({
	number: Schema.Number,
	state: Schema.String,
	labels: Schema.Array(GhLabel),
});

const GhComment = Schema.Struct({ body: Schema.String });
const GhComments = Schema.Array(GhComment);

const GhPrEntry = Schema.Struct({ number: Schema.Number, body: Schema.String });
const GhPrList = Schema.Array(GhPrEntry);

const GhReviewEntry = Schema.Struct({
	body: Schema.String,
	state: Schema.String,
	author: Schema.Struct({ login: Schema.String }),
});
const GhPrCommentEntry = Schema.Struct({
	body: Schema.String,
	author: Schema.Struct({ login: Schema.String }),
});
const GhPrDetail = Schema.Struct({
	reviews: Schema.optional(Schema.Array(GhReviewEntry)),
	comments: Schema.optional(Schema.Array(GhPrCommentEntry)),
});

export const makeGithubTracker = (config: {
	repo?: string;
	allStates?: ReadonlyArray<string>;
	dispatchStates?: ReadonlyArray<string>;
	parkedStates?: ReadonlyArray<string>;
	terminalStates?: ReadonlyArray<string>;
}) => {
	const allStates =
		config.allStates ??
		[
			...(config.dispatchStates ?? []),
			...(config.parkedStates ?? []),
			...(config.terminalStates ?? []),
		].filter((state, index, states) => states.indexOf(state) === index);
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
			return yield* Schema.decodeUnknown(GhIssueList)(
				JSON.parse(result.stdout),
			).pipe(
				Effect.mapError(
					(e) =>
						new TrackerError({
							code: "github_parse",
							message: `Failed to parse gh issue list: ${e}`,
						}),
				),
			);
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
			return yield* Schema.decodeUnknown(GhIssueView)(
				JSON.parse(result.stdout),
			).pipe(
				Effect.mapError(
					(e) =>
						new TrackerError({
							code: "github_parse",
							message: `Failed to parse gh issue view: ${e}`,
						}),
				),
			);
		});

	const mapState = (gh: {
		labels: ReadonlyArray<{ readonly name: string }>;
		state: string;
	}): string => {
		const labelNames = gh.labels.map((l) => normalizeState(l.name));
		for (const s of allStates) {
			if (labelNames.includes(normalizeState(s))) return s;
		}
		return gh.state === "OPEN" ? "" : "Closed";
	};

	const mapIssue = (gh: Schema.Schema.Type<typeof GhIssue>): Issue =>
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
			fetchCandidateIssues: (dispatchStates) =>
				Effect.gen(function* () {
					const ghIssues = yield* listIssues("open");
					const issues = ghIssues.map(mapIssue);
					const normalized = new Set(dispatchStates.map(normalizeState));
					const candidates = issues.filter((i) =>
						normalized.has(normalizeState(i.state)),
					);
					yield* Effect.logDebug("tracker_fetch").pipe(
						Effect.annotateLogs({
							component: "tracker",
							operation: "fetch_candidates",
							total: String(issues.length),
							candidates: String(candidates.length),
							dispatch_states: dispatchStates.join(","),
						}),
					);
					return candidates;
				}),

			fetchIssuesByStates: (states) =>
				Effect.gen(function* () {
					const ghIssues = yield* listIssues("all");
					const issues = ghIssues.map(mapIssue);
					const normalized = new Set(states.map(normalizeState));
					return issues.filter((i) => normalized.has(normalizeState(i.state)));
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

			fetchRunContext: (issueId, state) => {
				if (!config.repo) {
					return Effect.succeed(null);
				}

				return Effect.gen(function* () {
					const commentsResult = yield* runGh([
						"api",
						`repos/${config.repo}/issues/${issueId}/comments`,
					]).pipe(
						Effect.catchAll(() => Effect.succeed({ stdout: "[]", stderr: "" })),
					);

					const comments = yield* Schema.decodeUnknown(GhComments)(
						JSON.parse(commentsResult.stdout),
					).pipe(
						Effect.orElseSucceed(
							() => [] as ReadonlyArray<Schema.Schema.Type<typeof GhComment>>,
						),
					);
					let workpad: string | null = null;
					const workpadComment = comments.find((c) =>
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
						const prSearchResult = yield* runGh([
							"pr",
							"list",
							...repoArgs,
							"--state",
							"open",
							"--json",
							"number,headRefName,body",
							"--limit",
							"50",
						]).pipe(
							Effect.catchAll(() =>
								Effect.succeed({ stdout: "[]", stderr: "" }),
							),
						);

						const prs = yield* Schema.decodeUnknown(GhPrList)(
							JSON.parse(prSearchResult.stdout),
						).pipe(
							Effect.orElseSucceed(
								() => [] as ReadonlyArray<Schema.Schema.Type<typeof GhPrEntry>>,
							),
						);
						const linkedPr = prs.find((pr) => pr.body?.includes(`#${issueId}`));
						if (linkedPr) {
							const reviewResult = yield* runGh([
								"pr",
								"view",
								String(linkedPr.number),
								...repoArgs,
								"--json",
								"reviews,comments",
							]).pipe(
								Effect.catchAll(() =>
									Effect.succeed({ stdout: "{}", stderr: "" }),
								),
							);

							const prData = yield* Schema.decodeUnknown(GhPrDetail)(
								JSON.parse(reviewResult.stdout),
							).pipe(
								Effect.orElseSucceed(
									() => ({}) as Schema.Schema.Type<typeof GhPrDetail>,
								),
							);
							const parts: string[] = [];
							if (prData.reviews?.length) {
								for (const r of prData.reviews) {
									if (r.body)
										parts.push(
											`**${r.author.login}** (${r.state}):\n${r.body}`,
										);
								}
							}
							if (prData.comments?.length) {
								for (const c of prData.comments) {
									if (c.body) parts.push(`**${c.author.login}**:\n${c.body}`);
								}
							}
							reviews = parts.length > 0 ? parts.join("\n\n---\n\n") : null;
						}
					}

					return buildTrackerRunContext({ workpad, reviewFeedback: reviews });
				});
			},
		}),
	);
};

const plugin: TrackerPlugin = {
	name: "github",
	factory: (config: TrackerPluginConfig) =>
		makeGithubTracker({
			repo:
				typeof config["githubRepo"] === "string"
					? config["githubRepo"]
					: undefined,
			dispatchStates: config.dispatchStates,
			parkedStates: config.parkedStates,
			terminalStates: config.terminalStates,
		}),
};

export default plugin;
